<?php
$root=getenv('TEST_ROOT');
if(($_SERVER['HTTP_AUTHORIZATION']??'')!=='Bearer '.file_get_contents($root.'/token')){http_response_code(401);exit;}
$mode=trim(file_get_contents($root.'/mode'));$target=trim(file_get_contents($root.'/target'));
if($mode==='unavailable'){http_response_code(503);exit;}
if($mode==='rate-limited' || ($mode==='file-rate-limited' && $_SERVER['REQUEST_URI']!=='/v1/manifest')){http_response_code(429);header('Retry-After: 60');exit;}
if($mode==='redirect'){header('Location: http://127.0.0.1:3199/other');exit;}
if($_SERVER['REQUEST_URI']==='/v1/manifest') {
    $envelope=file_get_contents($root.'/'.$target.'/envelope');
    if($mode==='bad-signature'){$data=json_decode($envelope,true);$data['signature']=base64_encode(str_repeat('x',384));$envelope=json_encode($data);}
    header('Content-Type: application/json');echo $envelope;exit;
}
if(preg_match('~^/v1/releases/(0\.[56]\.0)/files/([A-Za-z0-9_.-]+)$~',$_SERVER['REQUEST_URI'],$matches)) {
    $data=file_get_contents($root.'/'.$matches[1].'/'.$matches[2]);
    if($mode==='bad-file')$data=str_repeat('x',strlen($data));
    if($mode==='partial')$data=substr($data,0,-1);
    echo $data;exit;
}
http_response_code(404);
