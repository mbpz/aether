# vhs tape: csv-summary demo
# Render:  vhs docs/assets/tapes/02-csv-summary.tape
# Output:  docs/assets/gifs/02-csv-summary.gif
Output docs/assets/gifs/02-csv-summary.gif
Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Tokyo Night"
Set Padding 20

Type "TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)"
Enter
Sleep 1s

Type "# Parse a CSV: row count + column types"
Sleep 500ms
Enter
Type "curl -s -X POST 'https://aether-demo.example.com/api/agent/execute' \\"
Enter
Type "  -H \"Authorization: Bearer $TOKEN\" \\"
Enter
Type "  -H 'Content-Type: application/json' \\"
Enter
Type "  -d '{\"manifestName\":\"csv-summary\",\"input\":{\"csv\":\"name,age,active\\nalice,30,true\\nbob,25,false\\ncharlie,40,true\"}}' | jq ."
Enter
Sleep 2s
