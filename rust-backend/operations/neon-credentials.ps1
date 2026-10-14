#requires -Version 7.4
<#
Server-only secret handling for the CampusMate Neon project. Register consumes
one JSON object on redirected stdin; all commands suppress child-process output.
Passwords never become command-line arguments or plaintext files.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Register','Inspect','CheckOwner','CheckApi','CheckMail','Migrate','PublishSecret','PublishFlyApi')][string]$Command,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$')][string]$StoreName='campusmate-staging',
    [ValidatePattern('^ep-[a-z0-9-]{8,80}$')][string]$EndpointId='ep-little-smoke-b30yyldu',
    [ValidatePattern('^br-[a-z0-9-]{8,80}$')][string]$BranchId='br-wispy-mouse-b30rf7e3',
    [switch]$GenerateRuntime,
    [ValidateSet('Owner','Api','Mail')][string]$Credential,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_-]{0,254}$')][string]$SecretName,
    [string]$BinDirectory=(Join-Path $PSScriptRoot '../target/release')
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$projectId='icy-wildflower-47757369'
$cloudProjectId='campusmate-7f1ab'
$databaseName='campusmate'
$privateDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/neon-private'))
$storePath=Join-Path $privateDirectory ($StoreName+'.dpapi')
$entropy=[Text.Encoding]::UTF8.GetBytes('CampusMate Neon credentials v1')
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-NoReparsePoint([string]$Path) {
    $item=Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UNSAFE_SECRET_PATH' }
    if (-not $item.PSIsContainer) { $item=$item.Directory }
    while ($null -ne $item) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'UNSAFE_SECRET_PATH' }
        $item=$item.Parent
    }
}
function Set-PrivateAcl([string]$Path,[bool]$Directory) {
    $existing=Get-Acl -LiteralPath $Path
    if ($existing.Owner -ne $userSid.Translate([Security.Principal.NTAccount]).Value) { throw 'UNSAFE_SECRET_OWNER' }
    if ($Directory) {
        $info=[IO.DirectoryInfo]::new($Path)
        $inherit=[Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [Security.AccessControl.InheritanceFlags]::ObjectInherit
    } else {
        $info=[IO.FileInfo]::new($Path)
        $inherit=[Security.AccessControl.InheritanceFlags]::None
    }
    # Touch the DACL only; PowerShell Set-Acl can attempt to set the SACL and
    # require SeSecurityPrivilege even when the caller owns the existing file.
    $acl=[IO.FileSystemAclExtensions]::GetAccessControl($info,[Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true,$false)
    foreach ($rule in @($acl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))) { [void]$acl.RemoveAccessRuleSpecific($rule) }
    foreach ($sid in @($userSid,$systemSid)) {
        $rule=[Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,$inherit,[Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow)
        [void]$acl.AddAccessRule($rule)
    }
    [IO.FileSystemAclExtensions]::SetAccessControl($info,$acl)
}
function Assert-PrivateAcl([string]$Path) {
    $acl=Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected -or $acl.Owner -ne $userSid.Translate([Security.Principal.NTAccount]).Value) { throw 'UNSAFE_SECRET_PERMISSIONS' }
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        if ($rule.IsInherited -or $rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $rule.IdentityReference.Value -notin @($userSid.Value,$systemSid.Value)) { throw 'UNSAFE_SECRET_PERMISSIONS' }
    }
}
function Assert-Url([string]$Value,[string]$Kind) {
    if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt 4096) { throw 'INVALID_DATABASE_SECRET' }
    $uri=[Uri]::new($Value,[UriKind]::Absolute)
    $pooled=$Kind -ne 'Owner'
    $hostName=$EndpointId+$(if ($pooled) {'-pooler'} else {''})+'.c-4.ap-southeast-1.aws.neon.tech'
    $roleName=switch ($Kind) { 'Owner' {'campusmate_schema_owner'} 'Api' {'campusmate_api_login'} 'Mail' {'campusmate_mail_login'} }
    $userInfo=$uri.UserInfo.Split(':',2)
    $minimumPasswordLength=if ($Kind -eq 'Owner') {16} else {32}
    if ($uri.Scheme -notin @('postgres','postgresql') -or $uri.Host -ne $hostName -or $uri.AbsolutePath -ne '/campusmate' -or
        ($uri.Port -ne -1 -and $uri.Port -ne 5432) -or $uri.Fragment -ne '' -or $uri.Query -ne '?sslmode=verify-full' -or
        $userInfo.Count -ne 2 -or [Uri]::UnescapeDataString($userInfo[0]) -ne $roleName -or [Uri]::UnescapeDataString($userInfo[1]).Length -lt $minimumPasswordLength) {
        throw 'INVALID_DATABASE_SECRET'
    }
    return $Value
}
function New-RuntimeUrl([string]$Kind) {
    $password=[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
    $roleName=if ($Kind -eq 'Api') {'campusmate_api_login'} else {'campusmate_mail_login'}
    return 'postgres://'+$roleName+':'+$password+'@'+$EndpointId+'-pooler.c-4.ap-southeast-1.aws.neon.tech/campusmate?sslmode=verify-full'
}
function Read-Store {
    Assert-NoReparsePoint $storePath
    Assert-PrivateAcl $privateDirectory
    Assert-PrivateAcl $storePath
    $cipher=[IO.File]::ReadAllBytes($storePath)
    if ($cipher.Length -gt 32768) { throw 'INVALID_SECRET_STORE' }
    $plain=[Security.Cryptography.ProtectedData]::Unprotect($cipher,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
    try { $data=[Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -AsHashtable } finally { [Array]::Clear($plain,0,$plain.Length) }
    if ($data.version -ne 1 -or $data.projectId -ne $projectId -or $data.branchId -ne $BranchId -or $data.endpointId -ne $EndpointId -or $data.database -ne $databaseName) { throw 'INVALID_SECRET_STORE' }
    $data.ownerDirectUrl=Assert-Url $data.ownerDirectUrl 'Owner'
    foreach ($entry in @(@('apiPooledUrl','Api'),@('mailPooledUrl','Mail'))) {
        if ($data.ContainsKey($entry[0])) { $data[$entry[0]]=Assert-Url $data[$entry[0]] $entry[1] }
    }
    return $data
}
function Invoke-PrivateChild([string]$File,[string[]]$ChildArguments,[hashtable]$Environment,[string]$InputValue,[int]$TimeoutSeconds,[switch]$CaptureOutput) {
    $start=[Diagnostics.ProcessStartInfo]::new()
    $start.FileName=$File
    $start.UseShellExecute=$false
    $start.CreateNoWindow=$true
    $start.RedirectStandardInput=$true
    $start.RedirectStandardOutput=$true
    $start.RedirectStandardError=$true
    $start.WorkingDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    foreach ($argument in $ChildArguments) { [void]$start.ArgumentList.Add($argument) }
    $start.Environment.Clear()
    # gcloud resolves its existing operator identity from the usual profile paths.
    foreach ($name in @('SystemRoot','WINDIR','PATH','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','CLOUDSDK_CONFIG','CLOUDSDK_PYTHON')) {
        $value=[Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $start.Environment[$name]=$value }
    }
    foreach ($key in $Environment.Keys) { $start.Environment[$key]=[string]$Environment[$key] }
    $process=[Diagnostics.Process]::new()
    $process.StartInfo=$start
    try {
        if (-not $process.Start()) { throw 'SECRET_COMMAND_FAILED' }
        $stdout=$process.StandardOutput.ReadToEndAsync()
        $stderr=$process.StandardError.ReadToEndAsync()
        if ($null -ne $InputValue) { $process.StandardInput.Write($InputValue) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit($TimeoutSeconds*1000)) { $process.Kill($true); $process.WaitForExit(); throw 'SECRET_COMMAND_TIMEOUT' }
        # Never forward arbitrary CLI messages: they can include submitted SQL/DSNs.
        $captured=$stdout.GetAwaiter().GetResult()
        [void]$stderr.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) { throw 'SECRET_COMMAND_FAILED' }
        if ($CaptureOutput) {
            if ($captured.Length -gt 131072) { throw 'SECRET_COMMAND_RESPONSE_TOO_LARGE' }
            return $captured
        }
    } finally { $process.Dispose() }
}

try {
    if (-not $IsWindows) { throw 'WINDOWS_DPAPI_REQUIRED' }
    if ($Command -eq 'Register') {
        if (-not [Console]::IsInputRedirected) { throw 'REDIRECTED_JSON_INPUT_REQUIRED' }
        if (Test-Path -LiteralPath $storePath) { throw 'SECRET_STORE_ALREADY_EXISTS' }
        $buffer=[char[]]::new(1024)
        $builder=[Text.StringBuilder]::new()
        while (($read=[Console]::In.Read($buffer,0,$buffer.Length)) -gt 0) {
            if ($builder.Length+$read -gt 16384) { throw 'SECRET_INPUT_TOO_LARGE' }
            [void]$builder.Append($buffer,0,$read)
        }
        $text=$builder.ToString()
        $inputData=$text | ConvertFrom-Json -AsHashtable
        foreach ($key in $inputData.Keys) { if ($key -notin @('ownerDirectUrl','apiPooledUrl','mailPooledUrl')) { throw 'INVALID_SECRET_INPUT' } }
        $data=@{version=1;projectId=$projectId;branchId=$BranchId;endpointId=$EndpointId;database=$databaseName;ownerDirectUrl=(Assert-Url $inputData.ownerDirectUrl 'Owner')}
        foreach ($entry in @(@('apiPooledUrl','Api'),@('mailPooledUrl','Mail'))) {
            if ($inputData.ContainsKey($entry[0])) { $data[$entry[0]]=Assert-Url $inputData[$entry[0]] $entry[1] }
            elseif ($GenerateRuntime) { $data[$entry[0]]=New-RuntimeUrl $entry[1] }
        }
        if (-not (Test-Path -LiteralPath $privateDirectory)) { [void][IO.Directory]::CreateDirectory($privateDirectory) }
        Assert-NoReparsePoint $privateDirectory
        Set-PrivateAcl $privateDirectory $true
        Assert-PrivateAcl $privateDirectory
        $plain=[Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress))
        try { $cipher=[Security.Cryptography.ProtectedData]::Protect($plain,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser) } finally { [Array]::Clear($plain,0,$plain.Length) }
        $stream=[IO.File]::Open($storePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try { $stream.Write($cipher,0,$cipher.Length) } finally { $stream.Dispose() }
        Set-PrivateAcl $storePath $false
        Assert-PrivateAcl $storePath
        Write-Output 'NEON_SECRET_STORE_REGISTERED'
    } else {
        $data=Read-Store
        if ($Command -eq 'Inspect') {
            Write-Output ('NEON_SECRET_STORE_OK project='+$projectId+' branch='+$BranchId+' database='+$databaseName+' api='+$data.ContainsKey('apiPooledUrl')+' mail='+$data.ContainsKey('mailPooledUrl'))
        } elseif ($Command -eq 'PublishFlyApi') {
            # This staging app and branch are deliberately fixed. Never send
            # owner/mail credentials or reuse this helper for another app.
            if ($BranchId -ne 'br-lively-cell-b3piehmz' -or $EndpointId -ne 'ep-young-bonus-b3777j39' -or
                -not $data.ContainsKey('apiPooledUrl')) { throw 'FLY_STAGING_TARGET_REQUIRED' }
            $flyPath='D:\Tools\Fly\fly.exe'
            if (-not (Test-Path -LiteralPath $flyPath -PathType Leaf)) { throw 'FLY_CLI_REQUIRED' }
            $cursorBytes=[byte[]]::new(48)
            [Security.Cryptography.RandomNumberGenerator]::Fill($cursorBytes)
            $cursor=[Convert]::ToBase64String($cursorBytes)
            try {
                # Values travel through the anonymous stdin pipe, never argv.
                $payload='DATABASE_URL='+$data.apiPooledUrl+"`nCURSOR_SECRET="+$cursor+"`n"
                Invoke-PrivateChild -File $flyPath -ChildArguments @('secrets','import','--app','campusmate-backend-502731779521','--stage') -Environment @{} -InputValue $payload -TimeoutSeconds 120
            } finally {
                [Array]::Clear($cursorBytes,0,$cursorBytes.Length)
                $payload=$null;$cursor=$null
            }
            Write-Output 'FLY_STAGING_API_SECRETS_STAGED'
        } elseif ($Command -eq 'PublishSecret') {
            if ([string]::IsNullOrWhiteSpace($Credential) -or [string]::IsNullOrWhiteSpace($SecretName)) { throw 'SECRET_SELECTION_REQUIRED' }
            $key=switch ($Credential) { 'Owner' {'ownerDirectUrl'} 'Api' {'apiPooledUrl'} 'Mail' {'mailPooledUrl'} }
            if (-not $data.ContainsKey($key)) { throw 'SECRET_SELECTION_MISSING' }
            $gcloud=(Get-Command gcloud.ps1 -CommandType ExternalScript).Source
            $sdkRoot=[IO.Path]::GetFullPath((Join-Path (Split-Path $gcloud) '..'))
            $python=Join-Path $sdkRoot 'platform/bundledpython/python.exe'
            $entryPoint=Join-Path $sdkRoot 'lib/gcloud.py'
            if (-not (Test-Path -LiteralPath $python -PathType Leaf) -or -not (Test-Path -LiteralPath $entryPoint -PathType Leaf)) { throw 'GCLOUD_BUNDLED_RUNTIME_REQUIRED' }
            # Bypass the PowerShell wrapper: it can alter stdin and native exit
            # propagation. Python receives the original anonymous stdin pipe.
            $childEnvironment=@{CLOUDSDK_ROOT_DIR=$sdkRoot;CLOUDSDK_CORE_DISABLE_PROMPTS='1';PYTHONIOENCODING='utf-8'}
            $childArguments=@('-S',$entryPoint,'secrets','versions','add',$SecretName,'--project',$cloudProjectId,'--data-file=-','--quiet','--format=json')
            $metadataJson=Invoke-PrivateChild -File $python -ChildArguments $childArguments -Environment $childEnvironment -InputValue $data[$key] -TimeoutSeconds 120 -CaptureOutput
            $metadata=$metadataJson | ConvertFrom-Json -AsHashtable
            $prefix='projects/(?:campusmate-7f1ab|[0-9]+)/secrets/'+[Regex]::Escape($SecretName)+'/versions/'
            if ($metadata.name -notmatch ('^'+$prefix+'([1-9][0-9]*)$') -or $metadata.state -ne 'ENABLED') { throw 'SECRET_VERSION_NOT_CONFIRMED' }
            $version=$Matches[1]
            # Independently require an ENABLED server-side metadata read. Never
            # access the stored payload here or print arbitrary CLI JSON.
            $describeArguments=@('-S',$entryPoint,'secrets','versions','describe',$version,'--secret',$SecretName,'--project',$cloudProjectId,'--quiet','--format=json')
            $confirmedJson=Invoke-PrivateChild -File $python -ChildArguments $describeArguments -Environment $childEnvironment -InputValue $null -TimeoutSeconds 90 -CaptureOutput
            $confirmed=$confirmedJson | ConvertFrom-Json -AsHashtable
            if ($confirmed.name -ne $metadata.name -or $confirmed.state -ne 'ENABLED') { throw 'SECRET_VERSION_NOT_CONFIRMED' }
            Write-Output ('NEON_SECRET_VERSION_PUBLISHED '+$Credential+' version='+$version)
        } else {
            $kind=switch ($Command) { 'CheckApi' {'api'} 'CheckMail' {'mail'} default {'owner'} }
            $key=switch ($kind) { 'api' {'apiPooledUrl'} 'mail' {'mailPooledUrl'} default {'ownerDirectUrl'} }
            if (-not $data.ContainsKey($key)) { throw 'SECRET_SELECTION_MISSING' }
            $envValues=@{APP_ENV='production';RUST_LOG='error';DATABASE_URL=$data[$key];DB_POOL_MODE='transaction'}
            if ($kind -eq 'owner') { $envValues.DATABASE_DIRECT_URL=$data[$key];$envValues.DB_POOL_MODE='direct' }
            $binary=if ($Command -eq 'Migrate') {'migrate.exe'} else {'check-database.exe'}
            $binaryPath=[IO.Path]::GetFullPath((Join-Path $BinDirectory $binary))
            if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) { throw 'RUST_BINARY_REQUIRED' }
            $arguments=if ($Command -eq 'Migrate') {@()} else {@('--kind',$kind)}
            Invoke-PrivateChild $binaryPath $arguments $envValues $null $(if ($Command -eq 'Migrate') {600} else {90})
            Write-Output ('NEON_'+$Command.ToUpperInvariant()+'_OK')
        }
    }
} catch {
    # Fixed labels only. Never print exception text, URL, JSON or child output.
    [Console]::Error.WriteLine('NEON_OPERATION_FAILED')
    exit 1
}
