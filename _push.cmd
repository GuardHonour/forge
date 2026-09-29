@echo off
cd /d "%~dp0"
echo ============================================================
echo  FORGE deploy - push the current local main to origin/main
echo ============================================================
echo.
git log --oneline origin/main..HEAD
echo.
echo The deployed build (2026-08-25r) is ALREADY LIVE and verified.
echo What is left here is only housekeeping: removing the two stray
echo index.html.txt / sw.js.txt files left by the first upload attempt.
echo They are inert - the site is fine without this push.
echo.
echo A GitHub sign-in may open in your browser. Complete it and the
echo push finishes on its own.
echo.
git -c credential.helper=manager push origin main
set RC=%ERRORLEVEL%
echo.
if "%RC%"=="0" (
  echo PUSH OK - the repo no longer carries the stray .txt files.
) else (
  echo PUSH FAILED with exit code %RC%
  echo No matter - just delete index.html.txt and sw.js.txt in the GitHub
  echo web UI instead ^(open the file, trash icon, commit^).
)
echo.
pause