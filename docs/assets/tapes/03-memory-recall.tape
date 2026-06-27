# vhs tape: memory-recall demo
Output docs/assets/gifs/03-memory-recall.gif
Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Tokyo Night"
Set Padding 20

Type "TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)"
Enter
Sleep 1s

Type "# Write a fact to L1+L2+L3 memory, then query L3 (semantic search)"
Sleep 500ms
Enter
Type "curl -s -X POST 'https://aether-demo.example.com/api/agent/execute' \\"
Enter
Type "  -H \"Authorization: Bearer $TOKEN\" \\"
Enter
Type "  -H 'Content-Type: application/json' \\"
Enter
Type "  -d '{\"manifestName\":\"memory-recall\",\"input\":{\"fact\":\"Deploy Demo workflow: 3 secrets needed\",\"query\":\"secrets for demo cluster\"}}' | jq ."
Enter
Sleep 2s
