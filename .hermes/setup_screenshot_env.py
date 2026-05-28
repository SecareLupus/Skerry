"""
Set up a test Skerry instance for taking landing page screenshots.
Creates 3 users, boots hub, adds members, posts messages with reactions.
"""
import subprocess, json, time, sys

BASE = "http://localhost:8080"

def curl(method, path, data=None, cookie=None):
    cmd = ["curl", "-s", "-X", method, f"{BASE}{path}", "-H", "Content-Type: application/json"]
    if cookie:
        cmd += ["-b", f"skerry_session={cookie}"]
    if data:
        cmd += ["-d", json.dumps(data)]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if r.returncode != 0:
        print(f"  FAIL: {method} {path} -> {r.stderr[:200]}")
        return None
    try:
        return json.loads(r.stdout) if r.stdout.strip() else {}
    except json.JSONDecodeError:
        print(f"  JSON parse error at {path}: {r.stdout[:200]}")
        return None

def dev_login(username):
    r = curl("POST", "/auth/dev-login", {"username": username})
    if not r:
        return None, None
    uid = r.get("productUserId")
    r2 = subprocess.run(
        ["curl", "-s", "-X", "POST", f"{BASE}/auth/dev-login",
         "-H", "Content-Type: application/json",
         "-d", json.dumps({"username": username}), "-i"],
        capture_output=True, text=True, timeout=30
    )
    cookie = None
    for line in r2.stdout.split("\n"):
        if "skerry_session=" in line:
            cookie = line.split("skerry_session=")[1].split(";")[0]
            break
    return uid, cookie

print("=== Creating users ===")
users = {}
for name in ["PixelGhost", "SynthWaves", "CraftBench"]:
    uid, cookie = dev_login(name)
    if uid:
        users[name] = {"id": uid, "cookie": cookie}
        print(f"  {name}: {uid}")
    else:
        sys.exit(1)

admin = users["PixelGhost"]

# Set display names
print("\n=== Setting display names ===")
for name, u in users.items():
    r = curl("PATCH", "/v1/users/@me/profile",
             {"displayName": name}, cookie=u["cookie"])
    print(f"  {name}: {'OK' if r else 'FAIL'}")

# Bootstrap
print("\n=== Bootstrapping ===")
bs = curl("GET", "/auth/bootstrap-status")
if bs and bs.get("initialized") and bs.get("bootstrapHubId"):
    hub_id = bs["bootstrapHubId"]
    print(f"  Already bootstrapped: {hub_id}")
else:
    r = curl("POST", "/auth/bootstrap-admin",
             {"hubName": "CO-OP HUB", "setupToken": "test_bootstrap_token"},
             cookie=admin["cookie"])
    if r:
        hub_id = r.get("hubId")
        print(f"  Bootstrapped: {hub_id}")
    else:
        print("  Bootstrap FAILED")
        sys.exit(1)

# Add members to hub
print("\n=== Adding users to hub ===")
for name in ["SynthWaves", "CraftBench"]:
    r = curl("PUT", f"/v1/hubs/{hub_id}/members/{users[name]['id']}",
             {"role": "hub_member"}, cookie=admin["cookie"])
    print(f"  {name}: {'OK' if r else 'FAIL'}")

# Get server
print("\n=== Getting server ===")
servers = curl("GET", f"/v1/hubs/{hub_id}/servers", cookie=admin["cookie"])
server = (servers.get("items") or [None])[0] if servers else None
if not server:
    r = curl("POST", f"/v1/hubs/{hub_id}/servers",
             {"name": "CO-OP HUB", "ownership": "hub"}, cookie=admin["cookie"])
    server = r
server_id = server["id"]
print(f"  Server: {server['name']} ({server_id})")

# Join members
print("\n=== Joining server ===")
for name in ["SynthWaves", "CraftBench"]:
    r = curl("POST", f"/v1/servers/{server_id}/join", {}, cookie=users[name]["cookie"])
    print(f"  {name}: {'OK' if r else 'FAIL'}")

# Get/create channels
print("\n=== Channels ===")
channels = curl("GET", f"/v1/servers/{server_id}/channels", cookie=admin["cookie"])
channel_map = {}
existing = channels.get("items", []) if channels else []
for ch in existing:
    channel_map[ch["name"]] = ch["id"]
    print(f"  #{ch['name']} ({ch['id']})")

# Optionally rename default channel to "general"
default_names = [ch["name"] for ch in existing]
if "general" not in channel_map and len(existing) > 0:
    default_id = existing[0]["id"]
    r = curl("PATCH", f"/v1/channels/{default_id}",
             {"name": "general"}, cookie=admin["cookie"])
    if r:
        channel_map["general"] = default_id
        print(f"  Renamed to #general")

for ch_name in ["announcements", "projects", "voice-lounge", "works-in-progress"]:
    if ch_name not in channel_map:
        r = curl("POST", f"/v1/servers/{server_id}/channels",
                 {"name": ch_name, "channelType": "text"}, cookie=admin["cookie"])
        if r:
            channel_map[ch_name] = r.get("channelId") or r.get("id")
            print(f"  Created #{ch_name}: {channel_map[ch_name]}")
        else:
            print(f"  FAILED: #{ch_name}")

general_id = channel_map.get("general")
if not general_id:
    print("No #general channel!")
    sys.exit(1)
print(f"\n  #general: {general_id}")

# Post messages
print("\n=== Posting messages ===")
messages = [
    ("PixelGhost", "Just finished the new sprite sheet for the collab game 🎮 Check it out in #works-in-progress!"),
    ("SynthWaves", "These look incredible! The color palette is chef's kiss. I'll have the soundtrack demo ready by Friday."),
    ("CraftBench", "Anyone around for a voice jam tonight? We're doing a playtest at 8pm in the voice lounge 🎙️"),
]
reactions = [
    [("🎮", 2), ("🔥", 2), ("👀", 2)],
    [("🎵", 2), ("✨", 2)],
    [("🎙️", 2), ("👍", 2)],
]
for i, (user, text) in enumerate(messages):
    u = users[user]
    r = curl("POST", f"/v1/channels/{general_id}/messages",
             {"content": text}, cookie=u["cookie"])
    if r:
        mid = r.get("messageId") or r.get("id")
        print(f"  {user}: {mid}")
        for emoji, count in reactions[i]:
            for _ in range(count):
                curl("PUT", f"/v1/channels/{general_id}/messages/{mid}/reactions/{emoji}",
                     {}, cookie=u["cookie"])
            print(f"    +{emoji} x{count}")
    else:
        print(f"  FAILED: {user}")

print("\n=== Done ===")
print(f"Hub: {hub_id}, Server: {server_id}, #general: {general_id}")
print(f"URL: http://localhost:8080/")
