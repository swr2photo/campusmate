#requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Register','Inspect','PublishFly')][string]$Command,
    [Parameter(Mandatory)][ValidateSet('Media','Verification')][string]$Kind
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$userSid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$privateDirectory=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../artifacts/face-verification/r2-private'))
$storePath=Join-Path $privateDirectory ($Kind.ToLowerInvariant()+'.dpapi')
$entropy=[Text.Encoding]::UTF8.GetBytes('CampusMate R2 staging credentials v1 '+$Kind)
$bucket=if($Kind -eq 'Media'){'campusmate-avatars'}else{'campusmate-verification-staging'}
# Reuse the reviewed/tested anonymous-pipe and DPAPI ACL helpers, without
# running the Neon command entrypoint or reading Neon credentials.
$parseErrors=$null;$tokens=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'neon-credentials.ps1'),[ref]$tokens,[ref]$parseErrors)
if($parseErrors.Count){throw 'SECRET_HELPER_PARSE_FAILED'}
foreach($name in @('Assert-NoReparsePoint','Set-PrivateAcl','Assert-PrivateAcl','Invoke-PrivateChild')){
    $definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name},$true)
    $functionSource=$definition.Extent.Text.Replace('$PSScriptRoot',("'"+$PSScriptRoot.Replace("'","''")+"'"))
    . ([scriptblock]::Create($functionSource))
}
try {
    if(-not $IsWindows){throw 'WINDOWS_DPAPI_REQUIRED'}
    if($Command -eq 'Register'){
        if(Test-Path -LiteralPath $storePath){throw 'SECRET_STORE_ALREADY_EXISTS'}
        if(-not [Console]::IsInputRedirected){throw 'REDIRECTED_INPUT_REQUIRED'}
        $inputText=[Console]::In.ReadToEnd()
        if($inputText.Length -gt 4096){throw 'INVALID_SECRET_INPUT'}
        $data=$inputText | ConvertFrom-Json -AsHashtable
        if($data.Keys.Count -ne 2 -or -not $data.ContainsKey('accessKeyId') -or -not $data.ContainsKey('secretAccessKey') -or
            $data.accessKeyId -notmatch '^[a-f0-9]{32}$' -or $data.secretAccessKey -notmatch '^[a-f0-9]{64}$'){throw 'INVALID_SECRET_INPUT'}
        $data.bucket=$bucket;$data.createdAt=[DateTimeOffset]::UtcNow.ToString('o');$data.ttlDays=30
        [void][IO.Directory]::CreateDirectory($privateDirectory)
        Assert-NoReparsePoint $privateDirectory
        Set-PrivateAcl $privateDirectory $true
        $bytes=[Text.Encoding]::UTF8.GetBytes(($data | ConvertTo-Json -Compress))
        try{$cipher=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)}finally{[Array]::Clear($bytes,0,$bytes.Length)}
        $stream=[IO.File]::Open($storePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
        try{$stream.Write($cipher,0,$cipher.Length)}finally{$stream.Dispose()}
        Set-PrivateAcl $storePath $false
        Write-Output ('R2_PRIVATE_STORE_REGISTERED '+$Kind)
    }else{
        Assert-NoReparsePoint $storePath;Assert-PrivateAcl $storePath
        $plain=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($storePath),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
        try{$data=[Text.Encoding]::UTF8.GetString($plain) | ConvertFrom-Json -AsHashtable}finally{[Array]::Clear($plain,0,$plain.Length)}
        if($data.bucket -ne $bucket){throw 'INVALID_SECRET_TARGET'}
        if($Command -eq 'Inspect'){
            Write-Output ('R2_PRIVATE_STORE_OK '+$Kind+' bucket='+$bucket+' ttlDays='+$data.ttlDays)
        }else{
            $prefix=if($Kind -eq 'Media'){'R2_MEDIA_'}else{'R2_'}
            $payload=$prefix+'ACCESS_KEY_ID='+$data.accessKeyId+"`n"+$prefix+'SECRET_ACCESS_KEY='+$data.secretAccessKey+"`n"
            try{Invoke-PrivateChild -File 'D:\Tools\Fly\fly.exe' -ChildArguments @('secrets','import','--app','campusmate-backend-502731779521','--stage') -Environment @{} -InputValue $payload -TimeoutSeconds 120}finally{$payload=$null}
            Write-Output ('R2_FLY_SECRET_STAGED '+$Kind)
        }
    }
}catch{
    Write-Error 'R2_SECRET_OPERATION_FAILED' -ErrorAction Continue
    exit 1
}finally{$data=$null;$inputText=$null}
