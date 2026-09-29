<?php
final class UmiDeliveryUpdater
{
    const FILES = array('umi-cookie-consent.min.js', 'umi-cookie-consent.min.css', 'THIRD_PARTY_NOTICES', 'DOMPURIFY-LICENSE.txt');
    private $config;
    private $lock;
    private $publicKey;

    public function __construct(array $config, $diagnostic = false)
    {
        foreach (array('baseUrl', 'token', 'publicKey', 'stateDir', 'assetDir') as $field) {
            if (!isset($config[$field]) || !is_string($config[$field]) || $config[$field] === '') throw new RuntimeException('Missing config: ' . $field);
        }
        if (!extension_loaded('curl') || !extension_loaded('openssl')) throw new RuntimeException('cURL and OpenSSL are required');
        if (!preg_match('/^[a-f0-9]{64}$/D', $config['token'])) throw new RuntimeException('Invalid token format');
        $url = parse_url($config['baseUrl']);
        $localHttp = ($url['scheme'] ?? '') === 'http' && in_array($url['host'] ?? '', array('127.0.0.1', 'localhost'), true);
        if (!$url || (($url['scheme'] ?? '') !== 'https' && !$localHttp) || isset($url['user']) || isset($url['pass']) || isset($url['query']) || isset($url['fragment']) || !empty($url['path'])) throw new RuntimeException('baseUrl must be an HTTPS origin (HTTP allowed only on loopback)');
        foreach (array('stateDir','assetDir','publicKey') as $field) if (substr($config[$field],0,1) !== '/') throw new RuntimeException('Paths must be absolute');
        $this->config = $config;
        $this->publicKey = file_get_contents($config['publicKey']);
        $key = openssl_pkey_get_public($this->publicKey);
        $details = $key ? openssl_pkey_get_details($key) : false;
        if (!$details || $details['type'] !== OPENSSL_KEYTYPE_RSA || $details['bits'] < 3072) throw new RuntimeException('Invalid trusted RSA public key');
        // Diagnostics may inspect the signed offer without creating directories,
        // acquiring the updater lock or writing the highest/active version.
        if ($diagnostic) return;
        $this->directory($config['stateDir'],0700);
        $this->directory($config['assetDir'],0755);
        $state = realpath($config['stateDir']); $assets = realpath($config['assetDir']);
        if ($state === $assets || strpos($state, $assets . '/') === 0) throw new RuntimeException('State must be outside assets');
        $this->lock = fopen($config['stateDir'] . '/update.lock','c');
        if (!$this->lock || !flock($this->lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('Another updater is running');
    }
    public function __destruct() { if (is_resource($this->lock)) { flock($this->lock,LOCK_UN); fclose($this->lock); } }
    private function directory($path,$mode) { if (!is_dir($path) && !mkdir($path,$mode,true)) throw new RuntimeException('Cannot create directory'); }
    private function atomic($path,$data,$mode=0600)
    {
        $tmp = tempnam(dirname($path),'.write-');
        try {
            if ($tmp === false || file_put_contents($tmp,$data) !== strlen($data) || !chmod($tmp,$mode) || !rename($tmp,$path)) throw new RuntimeException('Atomic write failed');
        } finally { if ($tmp !== false && file_exists($tmp)) unlink($tmp); }
    }
    private function validVersion($version)
    {
        return is_string($version) && preg_match('/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/D',$version);
    }
    private function request($path,$limit)
    {
        $data = ''; $curl = curl_init($this->config['baseUrl'] . $path);
        curl_setopt_array($curl,array(CURLOPT_HTTPHEADER=>array('Authorization: Bearer ' . $this->config['token']), CURLOPT_FOLLOWLOCATION=>false,
            CURLOPT_CONNECTTIMEOUT=>5, CURLOPT_TIMEOUT=>30, CURLOPT_SSL_VERIFYPEER=>true, CURLOPT_SSL_VERIFYHOST=>2,
            CURLOPT_PROTOCOLS=>CURLPROTO_HTTP | CURLPROTO_HTTPS, CURLOPT_WRITEFUNCTION=>function($handle,$chunk) use (&$data,$limit) {
                if (strlen($data)+strlen($chunk)>$limit) return 0;
                $data.=$chunk; return strlen($chunk);
            }));
        $ok=curl_exec($curl); $status=curl_getinfo($curl,CURLINFO_HTTP_CODE); curl_close($curl);
        if ($ok === false || $status !== 200) throw new RuntimeException('Download failed (HTTP ' . $status . ')');
        return $data;
    }
    private function verify($envelopeRaw)
    {
        $envelope=json_decode($envelopeRaw,true,32,JSON_THROW_ON_ERROR);
        foreach (array('manifest','signature','keyId') as $field) if (!isset($envelope[$field]) || !is_string($envelope[$field])) throw new RuntimeException('Invalid envelope');
        $raw=base64_decode($envelope['manifest'],true); $signature=base64_decode($envelope['signature'],true);
        if ($raw===false || $signature===false || !hash_equals(hash('sha256',$this->publicKey),$envelope['keyId']) || openssl_verify($raw,$signature,$this->publicKey,OPENSSL_ALGO_SHA256) !== 1) throw new RuntimeException('Signature verification failed');
        $manifest=json_decode($raw,true,32,JSON_THROW_ON_ERROR);
        if (($manifest['schema'] ?? null)!==1 || !$this->validVersion($manifest['version'] ?? null) || !isset($manifest['files']) || !is_array($manifest['files']) || count($manifest['files'])!==count(self::FILES)) throw new RuntimeException('Invalid manifest');
        $names=array();
        foreach ($manifest['files'] as $file) {
            if (!is_array($file) || !in_array($file['name'] ?? null,self::FILES,true) || in_array($file['name'],$names,true) || !is_int($file['size'] ?? null) || $file['size']<1 || $file['size']>5*1024*1024 || !is_string($file['sha256'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D',$file['sha256'])) throw new RuntimeException('Invalid manifest file');
            $names[]=$file['name'];
        }
        return $manifest;
    }
    private function offered()
    {
        $raw=$this->request('/v1/manifest',65536); $manifest=$this->verify($raw);
        $state=$this->config['stateDir'].'/highest-version';
        if (file_exists($state) && version_compare($manifest['version'],trim(file_get_contents($state)),'<')) throw new RuntimeException('Server downgrade refused; use a locally installed version for rollback');
        $this->atomic($state,$manifest['version']);
        return array($raw,$manifest);
    }
    public function check() { return $this->offered()[1]; }
    public function probe() { return $this->verify($this->request('/v1/manifest',65536)); }
    private function validateInstalled($version)
    {
        if (!$this->validVersion($version)) throw new RuntimeException('Invalid version');
        $dir=$this->config['assetDir'].'/'.$version;
        if (is_link($dir)) throw new RuntimeException('Release directory must not be a symlink');
        $manifest=$this->verify(file_get_contents($dir.'/release.json'));
        if ($manifest['version']!==$version) throw new RuntimeException('Installed version mismatch');
        foreach ($manifest['files'] as $file) {
            $path=$dir.'/'.$file['name'];
            if (is_link($path) || !is_file($path) || filesize($path)!==$file['size'] || !hash_equals($file['sha256'],hash_file('sha256',$path))) throw new RuntimeException('Installed file integrity failure');
        }
        return $manifest;
    }
    public function install()
    {
        list($raw,$manifest)=$this->offered(); $version=$manifest['version'];
        $destination=$this->config['assetDir'].'/'.$version;
        if (file_exists($destination)) { $this->validateInstalled($version); return $version; }
        $stage=$this->config['assetDir'].'/.stage-'.bin2hex(random_bytes(12));
        $this->directory($stage,0700);
        try {
            foreach ($manifest['files'] as $file) {
                $data=$this->request('/v1/releases/'.$version.'/files/'.$file['name'],$file['size']);
                if (strlen($data)!==$file['size'] || !hash_equals($file['sha256'],hash('sha256',$data))) throw new RuntimeException('File checksum mismatch');
                $this->atomic($stage.'/'.$file['name'],$data,0644);
            }
            $this->atomic($stage.'/release.json',$raw,0644);
            if (!chmod($stage,0755) || !rename($stage,$destination)) throw new RuntimeException('Cannot publish release directory');
            return $version;
        } finally {
            if (is_dir($stage)) { foreach (scandir($stage) as $name) if ($name!=='.' && $name!=='..') unlink($stage.'/'.$name); rmdir($stage); }
        }
    }
    public function activate($version)
    {
        $this->validateInstalled($version);
        $this->atomic($this->config['stateDir'].'/active-version',$version,0644);
    }
}
