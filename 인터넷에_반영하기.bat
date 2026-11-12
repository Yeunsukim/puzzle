@echo off
chcp 65001 > nul
title 퍼즐 친구들 - 인터넷에 반영하기
cd /d "%~dp0"

echo.
echo  ==============================================
echo    퍼즐 친구들: 고친 내용을 인터넷에 반영해요
echo  ==============================================
echo.

where git > nul 2> nul
if errorlevel 1 (
  echo  [문제] git 프로그램을 찾을 수 없어요. Claude에게 알려 주세요.
  echo.
  pause
  exit /b 1
)

echo  1. 바뀐 파일을 모으는 중...
git add -A

git diff --cached --quiet
if errorlevel 1 (
  echo  2. 바뀐 내용을 기록하는 중...
  git commit -q -m "고친 내용 반영 (%date% %time:~0,5%)"
) else (
  echo  2. 새로 바뀐 파일은 없어요. 올리지 않은 기록이 있는지 확인할게요.
)

echo  3. GitHub에 올리는 중... (로그인 창이 뜨면 로그인해 주세요)
git push origin main
if errorlevel 1 (
  echo.
  echo  [문제] 올리기에 실패했어요. 인터넷 연결을 확인하거나, 이 창을 캡처해서 Claude에게 보여 주세요.
  echo.
  pause
  exit /b 1
)

echo.
echo  ==============================================
echo    다 올렸어요!
echo    Render가 3~5분 안에 사이트를 새 버전으로 바꿔요.
echo    https://puzzle-friends.onrender.com
echo  ==============================================
echo.
pause
