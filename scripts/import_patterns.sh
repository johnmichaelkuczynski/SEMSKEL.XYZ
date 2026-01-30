#!/bin/bash
# Usage: ./scripts/import_patterns.sh /path/to/your/file.txt

if [ -z "$1" ]; then
  echo "Usage: ./scripts/import_patterns.sh AUTHORNAME_anything.txt"
  exit 1
fi

FILE="$1"

if [ ! -f "$FILE" ]; then
  echo "File not found: $FILE"
  exit 1
fi

FILENAME=$(basename "$FILE")
cp "$FILE" ./ingest/"$FILENAME"
echo "Copied $FILENAME to ingest folder. It will be processed automatically in 5 seconds."
