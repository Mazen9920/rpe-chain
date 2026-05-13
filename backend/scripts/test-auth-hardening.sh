#!/bin/bash
# Section 8 — Auth hardening smoke tests (Tier 1, Phase F)
#
# Verifies:
#   - login returns access + refresh
#   - refresh rotates and old refresh is rejected on reuse
#   - logout revokes refresh
#   - account lockout after N failed logins
#   - MFA setup → verify → forced second-factor on next login
set -e
BASE=http://localhost:3000/api
FAILED=0

jget() {
  node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{let j;try{j=JSON.parse(d)}catch{process.stdout.write("");return}let k=process.argv[1].split(".").reduce((a,p)=>(a==null?a:(p.match(/^\d+$/)?a[Number(p)]:a[p])),j);process.stdout.write(k==null?"":(typeof k==="object"?JSON.stringify(k):String(k)))})' "$1"
}
PASS() { echo " ✓ $1"; }
FAIL() { echo " ✗ $1"; FAILED=1; }

# Always start clean — reset any locked state
psql -U rpe_user -d rpe_supply -h localhost -c \
  "UPDATE \"User\" SET \"failedLoginCount\"=0, \"lockedUntil\"=NULL, \"totpEnabled\"=false, \"totpSecret\"=NULL;" \
  > /dev/null 2>&1 || true

echo "===== AUTH HARDENING ====="

echo "T1: login returns access + refresh"
R=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@rpechain.com","password":"Admin@123"}')
TOK=$(echo "$R" | jget token)
RT=$(echo "$R" | jget refreshToken)
[ -n "$TOK" ] && [ -n "$RT" ] && PASS "got token + refresh" || FAIL "resp=$R"

echo "T2: /me works with access token"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOK" $BASE/auth/me)
[ "$CODE" = "200" ] && PASS "200" || FAIL "got $CODE"

echo "T3: refresh rotates"
R2=$(curl -s -X POST $BASE/auth/refresh -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}")
TOK2=$(echo "$R2" | jget token)
RT2=$(echo "$R2" | jget refreshToken)
[ -n "$TOK2" ] && [ -n "$RT2" ] && [ "$RT2" != "$RT" ] && PASS "rotated" || FAIL "resp=$R2"

echo "T4: reusing old refresh → 401 (reuse detection)"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/refresh \
  -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT\"}")
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo "T5: reuse-detection revokes the rotated token too"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/refresh \
  -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT2\"}")
[ "$CODE" = "401" ] && PASS "session family revoked" || FAIL "got $CODE"

echo "T6: re-login + logout revokes refresh"
R3=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@rpechain.com","password":"Admin@123"}')
RT3=$(echo "$R3" | jget refreshToken)
curl -s -o /dev/null -X POST $BASE/auth/logout -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT3\"}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/refresh \
  -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$RT3\"}")
[ "$CODE" = "401" ] && PASS "logout revoked" || FAIL "got $CODE"

echo "T7: 5 bad passwords → 423 lockout on 6th attempt"
psql -U rpe_user -d rpe_supply -h localhost -c \
  "UPDATE \"User\" SET \"failedLoginCount\"=0, \"lockedUntil\"=NULL WHERE email='sales@rpechain.com';" \
  > /dev/null
for i in 1 2 3 4 5; do
  curl -s -o /dev/null -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d '{"email":"sales@rpechain.com","password":"wrong"}'
done
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"sales@rpechain.com","password":"wrong"}')
[ "$CODE" = "423" ] && PASS "423 locked" || FAIL "got $CODE"

echo "T8: locked user with correct password still 423"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/auth/login \
  -H 'Content-Type: application/json' -d '{"email":"sales@rpechain.com","password":"Admin@123"}')
[ "$CODE" = "423" ] && PASS "still 423" || FAIL "got $CODE"

# Reset lockout for the next phase
psql -U rpe_user -d rpe_supply -h localhost -c \
  "UPDATE \"User\" SET \"failedLoginCount\"=0, \"lockedUntil\"=NULL WHERE email='sales@rpechain.com';" \
  > /dev/null

echo "T9: MFA setup → otpauth URL returned"
R4=$(curl -s -X POST -H "Authorization: Bearer $TOK2" $BASE/auth/mfa/setup)
SECRET=$(echo "$R4" | jget base32)
OTPAUTH=$(echo "$R4" | jget otpauthUrl)
[ -n "$SECRET" ] && [ -n "$OTPAUTH" ] && PASS "setup OK" || FAIL "resp=$R4"

echo "T10: MFA verify with bad code → 401"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOK2" \
  $BASE/auth/mfa/verify -H 'Content-Type: application/json' -d '{"code":"000000"}')
[ "$CODE" = "401" ] && PASS "401" || FAIL "got $CODE"

echo "T11: MFA verify with valid TOTP → totpEnabled=true"
CODE=$(node -e "console.log(require('speakeasy').totp({secret:'$SECRET',encoding:'base32'}))")
R5=$(curl -s -X POST -H "Authorization: Bearer $TOK2" \
  $BASE/auth/mfa/verify -H 'Content-Type: application/json' -d "{\"code\":\"$CODE\"}")
EN=$(echo "$R5" | jget totpEnabled)
[ "$EN" = "true" ] && PASS "enabled" || FAIL "resp=$R5"

echo "T12: subsequent login → mfaRequired=true (no token yet)"
R6=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@rpechain.com","password":"Admin@123"}')
MR=$(echo "$R6" | jget mfaRequired)
MT=$(echo "$R6" | jget mfaToken)
TOK6=$(echo "$R6" | jget token)
[ "$MR" = "true" ] && [ -n "$MT" ] && [ -z "$TOK6" ] && PASS "challenge issued" || FAIL "resp=$R6"

echo "T13: /login/mfa with valid TOTP → full session"
CODE2=$(node -e "console.log(require('speakeasy').totp({secret:'$SECRET',encoding:'base32'}))")
R7=$(curl -s -X POST $BASE/auth/login/mfa -H 'Content-Type: application/json' \
  -d "{\"mfaToken\":\"$MT\",\"code\":\"$CODE2\"}")
TOK7=$(echo "$R7" | jget token)
[ -n "$TOK7" ] && PASS "full session granted" || FAIL "resp=$R7"

echo "T14: MFA disable requires password"
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "Authorization: Bearer $TOK7" \
  $BASE/auth/mfa/disable -H 'Content-Type: application/json' -d '{"password":"wrong"}')
[ "$CODE" = "401" ] && PASS "wrong password rejected" || FAIL "got $CODE"

R8=$(curl -s -X POST -H "Authorization: Bearer $TOK7" $BASE/auth/mfa/disable \
  -H 'Content-Type: application/json' -d '{"password":"Admin@123"}')
EN2=$(echo "$R8" | jget totpEnabled)
[ "$EN2" = "false" ] && PASS "MFA disabled" || FAIL "resp=$R8"

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "AUTH HARDENING: 14/14 ✓"
  exit 0
else
  echo "AUTH HARDENING: failures detected"
  exit 1
fi
