# vhs tape for the Aether hello-world demo skill.
# See https://github.com/charmbracelet/vhs for the tape format.
# This file is documentation only — render with:
#   vhs docs/assets/tapes/01-hello-world.tape
# (requires `vhs` binary; not vendored in CI).
#
# The output GIF is checked in to docs/assets/gifs/01-hello-world.gif
# after running vhs once locally. This file documents the script
# so the GIF is regenerable.

Output docs/assets/gifs/01-hello-world.gif

Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Tokyo Night"
Set Padding 20

Type "# Get the demo token from the secret auto-created by the deploy workflow"
Sleep 500ms
Enter
Type "TOKEN=$(kubectl -n aether-demo get secret aether-demo-gateway-auth -o jsonpath='{.data.LOCAL_API_TOKEN}' | base64 -d)"
Enter
Sleep 1s
Type "echo \"token len: ${#TOKEN}\""
Enter
Sleep 1s

Type "# Run the hello-world demo skill"
Sleep 500ms
Enter
Type "curl -s -X POST 'https://aether-demo.example.com/api/agent/execute' \\"
Enter
Type "  -H \"Authorization: Bearer $TOKEN\" \\"
Enter
Type "  -H 'Content-Type: application/json' \\"
Enter
Type "  -d '{\"manifestName\":\"hello-world\",\"code\":\"return {ok:true,output:\\\"Hello from Aether Agent @ \\\" + new Date().toISOString()};\"}' | jq ."
Enter
Sleep 2s
