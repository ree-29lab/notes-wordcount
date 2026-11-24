#!/bin/bash
# Double-click this file to install Notes Word Count.
# It runs install.sh from the same folder and keeps the window open so you can read the output.

cd "$(dirname "$0")" || exit 1
bash ./install.sh "$@"
code=$?

echo
read -n 1 -s -r -p "按任意键关闭此窗口…"
echo
exit $code
