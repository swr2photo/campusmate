#requires -Version 7.4
# No cloud/database calls. Uses synthetic input with the SDK's bundled Python.
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$helperPath=Join-Path $PSScriptRoot 'neon-credentials.ps1'
$parseErrors=$null;$tokens=$null
$ast=[Management.Automation.Language.Parser]::ParseFile($helperPath,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'HELPER_PARSE_FAILED' }
$definition=$ast.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Invoke-PrivateChild'},$true)
# Load the reviewed private-process function without running the helper entrypoint.
$functionSource=$definition.Extent.Text.Replace('$PSScriptRoot',("'"+$PSScriptRoot.Replace("'","''")+"'"))
. ([scriptblock]::Create($functionSource))
$gcloud=(Get-Command gcloud.ps1 -CommandType ExternalScript).Source
$sdkRoot=[IO.Path]::GetFullPath((Join-Path (Split-Path $gcloud) '..'))
$python=Join-Path $sdkRoot 'platform/bundledpython/python.exe'
$synthetic='synthetic-not-a-real-secret-stdin'
$code='import json,sys; raw=sys.stdin.buffer.read(); print(json.dumps({"args":sys.argv[1:],"length":len(raw),"exact":raw==b"synthetic-not-a-real-secret-stdin"}));'
$captured=Invoke-PrivateChild -File $python -ChildArguments @('-S','-c',$code,'public-argument','--data-file=-') -Environment @{} -InputValue $synthetic -TimeoutSeconds 10 -CaptureOutput
$result=$captured | ConvertFrom-Json -AsHashtable
if (-not $result.exact -or $result.length -ne $synthetic.Length -or ($result.args -join '|') -ne 'public-argument|--data-file=-') { throw 'STDIN_ARGUMENT_FORWARDING_FAILED' }
$failed=$false
try { Invoke-PrivateChild -File $python -ChildArguments @('-S','-c','import sys; print("do not forward"); sys.exit(7)') -Environment @{} -InputValue '' -TimeoutSeconds 10 -CaptureOutput | Out-Null }
catch { $failed=$_.Exception.Message -eq 'SECRET_COMMAND_FAILED' }
if (-not $failed) { throw 'NATIVE_EXIT_CODE_CHECK_FAILED' }
$empty=Invoke-PrivateChild -File $python -ChildArguments @('-S','-c','pass') -Environment @{} -InputValue '' -TimeoutSeconds 10 -CaptureOutput
if (-not [string]::IsNullOrEmpty($empty)) { throw 'EMPTY_OUTPUT_TEST_FAILED' }
$noCapture=@(Invoke-PrivateChild -File $python -ChildArguments @('-S','-c','print("do not forward")') -Environment @{} -InputValue '' -TimeoutSeconds 10)
if ($noCapture.Count) { throw 'CHILD_OUTPUT_SUPPRESSION_FAILED' }
$metadataSource='import json; print(json.dumps({"name":"projects/campusmate-7f1ab/secrets/HELPER_SYNTHETIC/versions/1","state":"ENABLED"}))'
$metadataJson=Invoke-PrivateChild -File $python -ChildArguments @('-S','-c',$metadataSource) -Environment @{} -InputValue '' -TimeoutSeconds 10 -CaptureOutput
$metadata=$metadataJson | ConvertFrom-Json -AsHashtable
if ($metadata.name -ne 'projects/campusmate-7f1ab/secrets/HELPER_SYNTHETIC/versions/1' -or $metadata.state -ne 'ENABLED') { throw 'METADATA_CAPTURE_FAILED' }
Write-Output 'NEON_PRIVATE_CHILD_TESTS_OK stdin arguments native-exit capture suppression metadata'
