<?php
/**
 * OAuth 2.0 Callback Handler для wFirma
 * Файл для загрузки на сервер comoon.io/oauth/callback
 */

// Настройки
$client_id = '0a749723fca35677bf7a6f931646385e';
$client_secret = 'c5b3bc3058a60caaf13b4e57cd4d5c15';
$redirect_uri = 'https://comoon.io/oauth/callback';
$base_url = 'https://api2.wfirma.pl';

// Логирование
function logMessage($message) {
    $log_file = '/tmp/wfirma_oauth.log';
    $timestamp = date('Y-m-d H:i:s');
    file_put_contents($log_file, "[$timestamp] $message\n", FILE_APPEND);
}

// Получение параметров
$code = $_GET['code'] ?? null;
$error = $_GET['error'] ?? null;
$state = $_GET['state'] ?? null;

logMessage("OAuth callback received - Code: " . ($code ? 'present' : 'missing') . ", Error: " . ($error ?: 'none'));

// Проверка на ошибки
if ($error) {
    logMessage("OAuth error: $error");
    http_response_code(400);
    echo json_encode([
        'error' => 'OAuth authorization failed',
        'error_description' => $error
    ]);
    exit;
}

// Проверка наличия кода
if (!$code) {
    logMessage("No authorization code received");
    http_response_code(400);
    echo json_encode([
        'error' => 'No authorization code received',
        'message' => 'Please complete the OAuth authorization flow'
    ]);
    exit;
}

// Обмен кода на access token
$token_url = "$base_url/oauth/token";
$token_data = [
    'grant_type' => 'authorization_code',
    'client_id' => $client_id,
    'client_secret' => $client_secret,
    'code' => $code,
    'redirect_uri' => $redirect_uri
];

logMessage("Exchanging code for token at: $token_url");

// Отправка запроса на получение токена
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $token_url);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($token_data));
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Content-Type: application/json',
    'Accept: application/json'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$response = curl_exec($ch);
$http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curl_error = curl_error($ch);
curl_close($ch);

logMessage("Token exchange response - HTTP: $http_code, Response: " . substr($response, 0, 200));

if ($curl_error) {
    logMessage("CURL error: $curl_error");
    http_response_code(500);
    echo json_encode([
        'error' => 'Network error',
        'message' => $curl_error
    ]);
    exit;
}

if ($http_code !== 200) {
    logMessage("Token exchange failed with HTTP $http_code");
    http_response_code($http_code);
    echo json_encode([
        'error' => 'Token exchange failed',
        'http_code' => $http_code,
        'response' => $response
    ]);
    exit;
}

// Парсинг ответа
$token_response = json_decode($response, true);

if (!$token_response) {
    logMessage("Invalid JSON response: $response");
    http_response_code(500);
    echo json_encode([
        'error' => 'Invalid response format',
        'response' => $response
    ]);
    exit;
}

if (!isset($token_response['access_token'])) {
    logMessage("No access token in response: " . json_encode($token_response));
    http_response_code(500);
    echo json_encode([
        'error' => 'No access token received',
        'response' => $token_response
    ]);
    exit;
}

// Успешное получение токена
logMessage("Access token received successfully");

// Тест API с полученным токеном
$test_url = "$base_url/contractors.json";
$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $test_url);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . $token_response['access_token'],
    'Accept: application/json'
]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 10);

$api_response = curl_exec($ch);
$api_http_code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

logMessage("API test - HTTP: $api_http_code, Response: " . substr($api_response, 0, 200));

// Возврат результата
header('Content-Type: application/json');
echo json_encode([
    'success' => true,
    'message' => 'OAuth authorization completed successfully',
    'access_token' => $token_response['access_token'],
    'token_type' => $token_response['token_type'] ?? 'Bearer',
    'expires_in' => $token_response['expires_in'] ?? null,
    'refresh_token' => $token_response['refresh_token'] ?? null,
    'scope' => $token_response['scope'] ?? null,
    'api_test' => [
        'endpoint' => $test_url,
        'http_code' => $api_http_code,
        'success' => $api_http_code === 200
    ],
    'instructions' => [
        'add_to_env' => 'WFIRMA_ACCESS_TOKEN=' . $token_response['access_token'],
        'add_refresh_token' => isset($token_response['refresh_token']) ? 'WFIRMA_REFRESH_TOKEN=' . $token_response['refresh_token'] : null
    ]
]);
?>






