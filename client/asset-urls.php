<?php
// Read once per HTML response so both URLs refer to the same immutable release.
function umiConsentAssetUrls($stateDir, $urlPrefix = '/assets/umi-consent')
{
    $version = trim((string) @file_get_contents($stateDir . '/active-version'));
    if (!preg_match('/^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/D', $version)) throw new RuntimeException('No active consent release');
    $base = rtrim($urlPrefix, '/') . '/' . $version;
    return array('js' => $base . '/umi-cookie-consent.min.js', 'css' => $base . '/umi-cookie-consent.min.css');
}
