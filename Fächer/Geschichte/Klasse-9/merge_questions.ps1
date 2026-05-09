# merge_questions.ps1
# Merges batch question files into a topic's questions.json.
#
# Usage (from any cwd):
#   pwsh C:\Users\simon\Storage\AI\LearningForge\Fächer\Geschichte\Klasse-9\merge_questions.ps1 -Topic Weimarer-Republik
#
# Layout assumed:
#   Fächer\Geschichte\Klasse-9\<Topic>\
#     questions.json                 (target — will be REWRITTEN)
#     batches\
#       batch-s1-001-040.json        (one file per batch; any name OK as long as .json)
#       batch-s1-041-080.json
#       ...
#
# Each batch file is a plain JSON array of question objects, e.g.
#   [
#     {"id":"g-wr-s1-001","subtopic":1,"type":"multiple_choice", ...},
#     ...
#   ]
#
# The script:
#   1. Reads every *.json file in <Topic>\batches\
#   2. Concatenates the arrays (preserving file order: sorted by name)
#   3. De-duplicates by "id" (last write wins, so a later batch can supersede an earlier one)
#   4. Sorts by id ascending (stable sort works because ids are zero-padded)
#   5. Writes the result to <Topic>\questions.json as { "questions": [ ... ] }
#
# Hard Rule #3 friendly: this script does NOT touch text content. HTML-entity encoding
# of question/answer strings is the author's responsibility inside each batch file.

param(
    [Parameter(Mandatory = $true)]
    [string]$Topic
)

$ErrorActionPreference = 'Stop'

$base = "C:\Users\simon\Storage\AI\LearningForge\Fächer\Geschichte\Klasse-9\$Topic"
if (-not (Test-Path $base)) { throw "Topic-Ordner nicht gefunden: $base" }

$batchDir = Join-Path $base 'batches'
if (-not (Test-Path $batchDir)) { throw "Kein batches\-Ordner unter $base" }

$files = Get-ChildItem -Path $batchDir -Filter *.json | Sort-Object Name
if ($files.Count -eq 0) { throw "Keine Batch-JSON-Dateien in $batchDir" }

Write-Host "Found $($files.Count) batch files in $batchDir" -ForegroundColor Cyan

$byId = [ordered]@{}
$total = 0
foreach ($f in $files) {
    $raw = Get-Content -Raw -LiteralPath $f.FullName -Encoding UTF8
    try {
        $arr = $raw | ConvertFrom-Json
    } catch {
        throw "Datei $($f.Name) ist kein valides JSON: $($_.Exception.Message)"
    }
    if ($arr -isnot [System.Array]) {
        throw "Datei $($f.Name) muss ein Array auf Top-Level sein (kein Objekt)."
    }
    foreach ($q in $arr) {
        if (-not $q.id) { throw "Frage ohne id in $($f.Name)" }
        $byId[$q.id] = $q
        $total++
    }
    Write-Host ("  {0,-40}  {1,4} Fragen" -f $f.Name, $arr.Count)
}

$dedupCount = $byId.Count
$skippedCount = $total - $dedupCount
if ($skippedCount -gt 0) {
    Write-Host "$skippedCount duplicate id(s) ueberschrieben (last-write-wins)" -ForegroundColor Yellow
}

# Sort by id ascending. Ids look like g-wr-s3-127 -> sort works lexicographically when zero-padded.
$sorted = $byId.Keys | Sort-Object | ForEach-Object { $byId[$_] }

$out = [ordered]@{ questions = $sorted }
$json = $out | ConvertTo-Json -Depth 32 -Compress:$false

# Write with UTF-8 (no BOM) — Powershell 7's UTF8NoBOM is preferred; on 5.1 use -Encoding UTF8 (with BOM is OK for our app).
$target = Join-Path $base 'questions.json'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $json, $utf8NoBom)

Write-Host ""
Write-Host "OK -> $target  ($dedupCount Fragen)" -ForegroundColor Green
