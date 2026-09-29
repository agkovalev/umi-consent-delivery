<?php
require '/app/client/updater.php';
// This test key is generated inside a temporary directory and never trusted by the pilot.
$root=sys_get_temp_dir().'/delivery-test-'.bin2hex(random_bytes(8));mkdir($root,0700);
$key=openssl_pkey_new(array('private_key_bits'=>3072,'private_key_type'=>OPENSSL_KEYTYPE_RSA));
$public=openssl_pkey_get_details($key)['key'];file_put_contents($root.'/public.pem',$public);
$token=bin2hex(random_bytes(32));
$config=array('baseUrl'=>'http://127.0.0.1:3199','token'=>$token,'publicKey'=>$root.'/public.pem','stateDir'=>$root.'/state','assetDir'=>$root.'/assets');
file_put_contents($root.'/token',$token);
function releaseFixture($root,$version,$key,$public) {
    $files=array();$dir=$root.'/'.$version;mkdir($dir);
    foreach(UmiDeliveryUpdater::FILES as $name) {
        $data='fixture '.$version.' '.$name;file_put_contents($dir.'/'.$name,$data);
        $files[]=array('name'=>$name,'size'=>strlen($data),'sha256'=>hash('sha256',$data));
    }
    $manifest=json_encode(array('schema'=>1,'version'=>$version,'files'=>$files));
    openssl_sign($manifest,$signature,$key,OPENSSL_ALGO_SHA256);
    file_put_contents($dir.'/envelope',json_encode(array('manifest'=>base64_encode($manifest),'signature'=>base64_encode($signature),'keyId'=>hash('sha256',$public))));
}
releaseFixture($root,'0.5.0',$key,$public);releaseFixture($root,'0.6.0',$key,$public);
file_put_contents($root.'/mode','ok');file_put_contents($root.'/target','0.5.0');
$process=proc_open('exec '.escapeshellarg(PHP_BINARY).' -S 127.0.0.1:3199 /app/tests/client-router.php',array(0=>array('pipe','r'),1=>array('file',$root.'/server.log','a'),2=>array('file',$root.'/server.log','a')),$pipes,null,array('TEST_ROOT'=>$root));
function expectFailure($fn,$message) { try {$fn();} catch(Throwable $e) { echo 'PASS '.$message."\n";return; } throw new RuntimeException('Expected failure: '.$message); }
function ensure($condition,$message) { if(!$condition) throw new RuntimeException($message);echo 'PASS '.$message."\n"; }
try {
    $ready=false;for($i=0;$i<50;$i++){ $socket=@fsockopen('127.0.0.1',3199,$errno,$errstr,0.1);if($socket){fclose($socket);$ready=true;break;}usleep(100000); }
    ensure($ready,'test HTTP server ready');
    $client=new UmiDeliveryUpdater($config);
    expectFailure(function()use($config){new UmiDeliveryUpdater($config);},'concurrent updater refused');
    ensure($client->install()==='0.5.0','install initial release');$client->activate('0.5.0');
    file_put_contents($root.'/target','0.6.0');
    foreach(array('bad-signature','bad-file','partial','redirect','unavailable') as $mode) {
        file_put_contents($root.'/mode',$mode);
        expectFailure(function()use($client){$client->install();},$mode.' refused');
        ensure(file_get_contents($root.'/state/active-version')==='0.5.0','active version preserved');
        ensure(!file_exists($root.'/assets/0.6.0'),'no partial published release');
    }
    file_put_contents($root.'/mode','ok');
    $originalEnvelope=file_get_contents($root.'/0.6.0/envelope');
    foreach(array('../escape','duplicate','oversized') as $invalid) {
        $envelope=json_decode($originalEnvelope,true);$manifest=json_decode(base64_decode($envelope['manifest']),true);
        if($invalid==='../escape')$manifest['files'][0]['name']='../escape';
        elseif($invalid==='duplicate')$manifest['files'][1]['name']=$manifest['files'][0]['name'];
        else $manifest['files'][0]['size']=6*1024*1024;
        $raw=json_encode($manifest);openssl_sign($raw,$signature,$key,OPENSSL_ALGO_SHA256);
        $envelope['manifest']=base64_encode($raw);$envelope['signature']=base64_encode($signature);
        file_put_contents($root.'/0.6.0/envelope',json_encode($envelope));
        expectFailure(function()use($client){$client->install();},'signed invalid manifest '.$invalid.' refused');
    }
    file_put_contents($root.'/0.6.0/envelope',$originalEnvelope);
    file_put_contents($root.'/mode','ok');ensure($client->install()==='0.6.0','upgrade downloaded');
    ensure(file_get_contents($root.'/state/active-version')==='0.5.0','installation needs explicit activation');
    $client->activate('0.6.0');ensure(file_get_contents($root.'/state/active-version')==='0.6.0','activate upgrade');
    $client->activate('0.5.0');ensure(file_get_contents($root.'/state/active-version')==='0.5.0','local rollback');
    file_put_contents($root.'/target','0.5.0');expectFailure(function()use($client){$client->check();},'server downgrade refused');
    file_put_contents($root.'/assets/0.6.0/umi-cookie-consent.min.js','changed');
    expectFailure(function()use($client){$client->activate('0.6.0');},'activation rechecks installed files');
    expectFailure(function()use($client){$client->activate('../bad');},'path traversal refused');
    unset($client);
    $bad=$config;$bad['baseUrl']='http://delivery.example';expectFailure(function()use($bad){new UmiDeliveryUpdater($bad);},'non-loopback HTTP refused');
    $bad=$config;$bad['token']=str_repeat('0',64);$client=new UmiDeliveryUpdater($bad);expectFailure(function()use($client){$client->check();},'invalid credential refused');unset($client);
    echo "PHP delivery tests passed\n";
} finally {
    proc_terminate($process);proc_close($process);
    $iterator=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
    foreach($iterator as $file) {if($file->isDir())rmdir($file->getPathname());else unlink($file->getPathname());}rmdir($root);
}
