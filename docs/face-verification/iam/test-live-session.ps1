param(
    [string]$Profile = 'campusmate',
    [string]$EvidencePath = (Join-Path $PSScriptRoot 'live-session-evidence.json')
)

# Creates one short-lived empty session. No camera, image upload, or badge mutation.
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$region = 'ap-southeast-7'
$projectId = '502731779521'
$backendArn = "arn:aws:iam::${projectId}:role/campusmate-backend"
$streamArn = "arn:aws:iam::${projectId}:role/campusmate-liveness-stream"
$savedEnvironment = @{}
foreach ($name in @('AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','AWS_PROFILE','AWS_REGION','AWS_DEFAULT_REGION')) {
    $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Invoke-AwsJson([string[]]$Arguments) {
    $result = & aws @Arguments --output json --no-cli-pager 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result | Out-String) }
    return ($result | Out-String | ConvertFrom-Json)
}

function Set-TemporaryCredentials($Credentials) {
    $env:AWS_ACCESS_KEY_ID = $Credentials.AccessKeyId
    $env:AWS_SECRET_ACCESS_KEY = $Credentials.SecretAccessKey
    $env:AWS_SESSION_TOKEN = $Credentials.SessionToken
    Remove-Item Env:AWS_PROFILE -ErrorAction SilentlyContinue
    $env:AWS_REGION = $region
    $env:AWS_DEFAULT_REGION = $region
}

function Assert-AccessDenied([string]$Name, [string[]]$Arguments) {
    $result = & aws @Arguments --output json --no-cli-pager 2>&1
    $exitCode = $LASTEXITCODE
    $message = $result | Out-String
    if ($exitCode -eq 0) {
        # Successful STS responses can contain credentials: never print the body.
        throw "Expected AccessDenied for ${Name}, but the operation succeeded"
    }
    if ($message -notmatch 'AccessDenied') {
        throw "Expected AccessDenied for ${Name}; got exit ${exitCode}: $message"
    }
    return @{ Check = $Name; Result = 'PASS'; Error = 'AccessDenied' }
}

try {
    # Refresh login in the profile's configured login Region, then use credentials
    # only in process memory against Thailand STS/Rekognition endpoints.
    $null = Invoke-AwsJson @('sts','get-caller-identity','--profile',$Profile,'--region','ap-southeast-2')
    $loginCredentials = Invoke-AwsJson @('configure','export-credentials','--profile',$Profile,'--format','process')
    Set-TemporaryCredentials $loginCredentials
    $caller = Invoke-AwsJson @('sts','get-caller-identity','--region',$region)
    if ($caller.Account -ne $projectId -or $caller.Arn -notlike "arn:aws:sts::${projectId}:assumed-role/AccountFullAccessRole/*") {
        throw 'Unexpected AWS project or bootstrap principal'
    }

    $checks = @()
    $checks += Assert-AccessDenied 'Administrator cannot directly assume streaming role' @('sts','assume-role','--role-arn',$streamArn,'--role-session-name','campusmate-deny-direct-stream','--duration-seconds','900','--region',$region)
    $backend = Invoke-AwsJson @('sts','assume-role','--role-arn',$backendArn,'--role-session-name','campusmate-liveness-smoke','--duration-seconds','900','--region',$region)
    Set-TemporaryCredentials $backend.Credentials
    $backendCaller = Invoke-AwsJson @('sts','get-caller-identity','--region',$region)
    $createdAt = [DateTimeOffset]::UtcNow
    $session = Invoke-AwsJson @('rekognition','create-face-liveness-session','--settings','{"AuditImagesLimit":0}','--client-request-token',([guid]::NewGuid().ToString()),'--region',$region)
    if ($session.SessionId -notmatch '^[0-9a-f-]{36}$') { throw 'No valid SessionId returned' }
    $results = Invoke-AwsJson @('rekognition','get-face-liveness-session-results','--session-id',$session.SessionId,'--region',$region)

    $stream = Invoke-AwsJson @('sts','assume-role','--role-arn',$streamArn,'--role-session-name','campusmate-stream-smoke','--duration-seconds','900','--policy',((Get-Content -LiteralPath (Join-Path $PSScriptRoot 'stream-permissions.json') -Raw | ConvertFrom-Json) | ConvertTo-Json -Depth 20 -Compress),'--region',$region)
    Set-TemporaryCredentials $stream.Credentials
    $streamCaller = Invoke-AwsJson @('sts','get-caller-identity','--region',$region)
    $checks += Assert-AccessDenied 'Streaming cannot create sessions' @('rekognition','create-face-liveness-session','--settings','{"AuditImagesLimit":0}','--region',$region)
    $checks += Assert-AccessDenied 'Streaming cannot retrieve results' @('rekognition','get-face-liveness-session-results','--session-id',$session.SessionId,'--region',$region)
    $checks += Assert-AccessDenied 'Streaming cannot compare faces' @('rekognition','compare-faces','--cli-input-json','{"SourceImage":{"Bytes":"/9j/2Q=="},"TargetImage":{"Bytes":"/9j/2Q=="}}','--region',$region)
    $checks += Assert-AccessDenied 'Streaming cannot assume backend' @('sts','assume-role','--role-arn',$backendArn,'--role-session-name','campusmate-deny-backend','--duration-seconds','900','--region',$region)

    $evidence = [ordered]@{
        Project = 'Building Momentum'; ProjectId = $projectId; Region = $region
        CheckedAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
        BackendPrincipal = $backendCaller.Arn; StreamingPrincipal = $streamCaller.Arn
        BackendCredentialExpiresAt = $backend.Credentials.Expiration
        StreamingCredentialExpiresAt = $stream.Credentials.Expiration
        CreateFaceLivenessSession = 'PASS'; GetFaceLivenessSessionResults = 'PASS'
        SessionId = $session.SessionId; SessionCreatedAtUtc = $createdAt.ToString('o')
        SessionStatus = $results.Status; AuditImagesLimit = 0; OutputConfig = $null
        Checks = $checks
        VideoStreaming = 'NOT RUN'; BackendCompareFacesWithImages = 'NOT RUN'
        BiometricDataUploaded = $false; ProductionApplicationDeployment = $false
        BillingPlanCheck = 'GetAccountPlanState returned ResourceNotFoundException; paid/free status unconfirmed'
    }
    $evidence | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $EvidencePath -Encoding utf8
    $evidence | ConvertTo-Json -Depth 20
}
finally {
    foreach ($name in $savedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process')
    }
    $loginCredentials = $null; $backend = $null; $stream = $null
}
