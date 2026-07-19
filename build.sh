#!/bin/bash
set -e
cd "$(dirname "$0")/extension"
rm -f ../conseq-performance-chart.zip
zip -r ../conseq-performance-chart.zip . -x "*.DS_Store"
echo "Created conseq-performance-chart.zip ($(du -sh ../conseq-performance-chart.zip | cut -f1))"
