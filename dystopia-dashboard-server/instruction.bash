# Create session
curl -s -X POST http://localhost:8787/api/session \
  -H 'Content-Type: application/json' \
  -d '{"scenarioId":"sector-c-ops-01"}'
# => {"sessionId":"ABCD1234","joinCode":"K9Q3ZT"}

# Start session clock
curl -s -X POST http://localhost:8787/api/session/ABCD1234/start

# Send participant input
curl -s -X POST http://localhost:8787/api/session/ABCD1234/input \
  -H 'Content-Type: application/json' \
  -d '{"joinCode":"K9Q3ZT","participantId":"p1","codename":"Unit 5273","eventId":"evt-034","action":"Dispatch units"}'

# Check Leaderboard
curl -s http://localhost:8787/api/session/ABCD1234/leaderboard | jq