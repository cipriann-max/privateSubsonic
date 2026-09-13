import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiClient,
  SubsonicClient,
  createFirstAdmin,
  getAuthStatus,
  type Album,
  type ManagedUser,
  type Role,
  type Track,
} from "./lib/subsonic";
import { artistHue, placeholderInitials } from "./lib/placeholder";

/**
 * Web app: first-run setup → login → { search | users }.
 * Search is the player; Users is admin-only account management.
 */

const CREDS_KEY = "privatesubsonic.creds";

interface Creds {
  username: string;
  password: string;
}

type View = "search" | "users";

function loadCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Creds;
    if (typeof parsed.username === "string" && typeof parsed.password === "string") {
      return parsed;
    }
  } catch {
    // ignore malformed storage
  }
  return null;
}

export default function App() {
  const [client, setClient] = useState<SubsonicClient | null>(null);
  const [api, setApi] = useState<ApiClient | null>(null);
  const [view, setView] = useState<View>("search");
  const [status, setStatus] = useState("");
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [bootError, setBootError] = useState("");

  useEffect(() => {
    const creds = loadCreds();
    if (creds) {
      setClient(new SubsonicClient(creds));
      setApi(new ApiClient(creds));
    }
    // Surface a failed status check instead of silently showing the login
    // screen — otherwise a misrouted /api looks like "wrong password".
    void getAuthStatus()
      .then((s) => setNeedsSetup(s.needsSetup))
      .catch((err: unknown) => {
        setBootError(
          err instanceof Error
            ? `Cannot reach the server API: ${err.message}`
            : "Cannot reach the server API.",
        );
        setNeedsSetup(false);
      });
  }, []);

  const handleLogin = useCallback((username: string, password: string) => {
    const next = new SubsonicClient({ username, password });
    void next
      .ping()
      .then((ok) => {
        if (ok) {
          localStorage.setItem(CREDS_KEY, JSON.stringify({ username, password }));
          setClient(next);
          setApi(new ApiClient({ username, password }));
          setStatus("");
        } else {
          setStatus("Login failed: wrong username or password.");
        }
      })
      .catch((err: unknown) => {
        setStatus(err instanceof Error ? `Cannot reach server: ${err.message}` : "Cannot reach server.");
      });
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(CREDS_KEY);
    setClient(null);
    setApi(null);
    setView("search");
  }, []);

  if (needsSetup === null) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (bootError) {
    return (
      <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-2 p-6">
        <h1 className="text-lg font-semibold">Cannot start</h1>
        <p className="text-sm text-red-500">{bootError}</p>
        <p className="text-sm text-muted-foreground">
          Check that the server is running and that /api is reachable.
        </p>
      </div>
    );
  }

  if (needsSetup) {
    return (
      <Setup
        onDone={(username, password) => {
          setNeedsSetup(false);
          handleLogin(username, password);
        }}
      />
    );
  }

  if (!client || !api) {
    return <Login onLogin={handleLogin} status={status} />;
  }

  return (
    <div className="flex min-h-screen">
      <SideNav view={view} onSelect={setView} onLogout={handleLogout} />
      <main className="flex-1 p-6">
        {view === "search" ? <SearchPanel client={client} /> : <UsersPanel api={api} />}
      </main>
    </div>
  );
}

function SideNav({
  view,
  onSelect,
  onLogout,
}: {
  view: View;
  onSelect: (view: View) => void;
  onLogout: () => void;
}) {
  const items: Array<{ id: View; label: string }> = [
    { id: "search", label: "Search" },
    { id: "users", label: "Users" },
  ];
  return (
    <nav aria-label="Sections" className="flex w-48 shrink-0 flex-col gap-1 border-r p-3">
      <h1 className="mb-2 px-2 text-lg font-semibold tracking-tight">privateSubsonic</h1>
      {items.map((item) => (
        <button
          key={item.id}
          className={`rounded-md px-3 py-2 text-left text-sm ${
            view === item.id ? "bg-accent font-medium" : "hover:bg-accent"
          }`}
          aria-current={view === item.id ? "page" : undefined}
          onClick={() => onSelect(item.id)}
        >
          {item.label}
        </button>
      ))}
      <button
        className="mt-auto rounded-md border px-3 py-2 text-left text-sm"
        onClick={onLogout}
      >
        Log out
      </button>
    </nav>
  );
}

function Setup({ onDone }: { onDone: (username: string, password: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }
      setBusy(true);
      setError("");
      void createFirstAdmin({ username, password })
        .then(() => onDone(username, password))
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Setup failed.");
        })
        .finally(() => setBusy(false));
    },
    [username, password, confirm, onDone],
  );

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create the admin account</h1>
      <p className="text-sm text-muted-foreground">
        No users exist yet. The first account is always an administrator and can add
        and remove other users afterwards.
      </p>
      <form className="flex flex-col gap-3" onSubmit={submit}>
        <input
          className="rounded-md border px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <input
          className="rounded-md border px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="new-password"
        />
        <input
          className="rounded-md border px-3 py-2"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
          autoComplete="new-password"
        />
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-2 text-primary-foreground"
          disabled={busy}
        >
          {busy ? "Creating…" : "Create admin"}
        </button>
      </form>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </div>
  );
}

function Login({ onLogin, status }: { onLogin: (u: string, p: string) => void; status: string }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">privateSubsonic</h1>
      <p className="text-sm text-muted-foreground">Sign in to continue.</p>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          onLogin(username, password);
        }}
      >
        <input
          className="rounded-md border px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoComplete="username"
        />
        <input
          className="rounded-md border px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
        />
        <button type="submit" className="rounded-md bg-primary px-3 py-2 text-primary-foreground">
          Sign in
        </button>
      </form>
      {status ? <p className="text-sm text-red-500">{status}</p> : null}
    </div>
  );
}

function SearchPanel({ client }: { client: SubsonicClient }) {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [status, setStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSearch = useCallback(
    async (q: string) => {
      setSearching(true);
      setStatus("");
      try {
        const results = await client.search3(q);
        setAlbums(results.album ?? []);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "search failed");
      } finally {
        setSearching(false);
      }
    },
    [client],
  );

  const openAlbum = useCallback(
    async (album: Album) => {
      try {
        const full = await client.getAlbum(album.id);
        setSelectedAlbum(full);
        setTracks(full.song ?? []);
      } catch (err) {
        setStatus(err instanceof Error ? err.message : "album fetch failed");
      }
    },
    [client],
  );

  const playTrack = useCallback((track: Track) => {
    setNowPlaying(track);
    requestAnimationFrame(() => {
      void audioRef.current?.play().catch(() => {
        setStatus("Playback blocked by the browser — press play.");
      });
    });
  }, []);

  const handleAudioError = useCallback(() => {
    const el = audioRef.current;
    if (!el || !el.error || el.error.code === 1) {
      return;
    }
    setStatus("Stream failed: the item may be lending-restricted on archive.org.");
  }, []);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <SearchBar onSearch={handleSearch} searching={searching} />

      {status ? <p className="text-sm text-red-500">{status}</p> : null}

      <div className="grid gap-6 md:grid-cols-2">
        <section aria-label="Search results" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">Albums</h2>
          {albums.length === 0 && !searching ? (
            <p className="text-sm text-muted-foreground">Search the Internet Archive to get started.</p>
          ) : null}
          {albums.map((album) => (
            <button
              key={album.id}
              className="flex items-center gap-3 rounded-lg border p-2 text-left hover:bg-accent"
              onClick={() => void openAlbum(album)}
            >
              <AlbumThumb client={client} album={album} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{album.title}</span>
                <span className="truncate text-sm text-muted-foreground">{album.artist}</span>
              </span>
            </button>
          ))}
        </section>

        <section aria-label="Album tracks" className="flex flex-col gap-2">
          <h2 className="text-lg font-medium">{selectedAlbum ? selectedAlbum.title : "Tracks"}</h2>
          {tracks.map((track) => (
            <button
              key={track.id}
              className={`flex items-center justify-between rounded-lg border p-2 text-left hover:bg-accent ${
                nowPlaying?.id === track.id ? "bg-accent" : ""
              }`}
              onClick={() => playTrack(track)}
            >
              <span className="truncate text-sm">
                {track.track ? `${track.track}. ` : ""}
                {track.title}
              </span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {track.duration ? formatDuration(track.duration) : ""}
              </span>
            </button>
          ))}
        </section>
      </div>

      {nowPlaying ? (
        <footer className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <audio
              ref={audioRef}
              controls
              className="w-full"
              src={client.streamUrl(nowPlaying.id)}
              onError={handleAudioError}
            />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {nowPlaying.artist} — {nowPlaying.title}
          </p>
        </footer>
      ) : null}
    </div>
  );
}

function UsersPanel({ api }: { api: ApiClient }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [pwTarget, setPwTarget] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await api.listUsers();
      setUsers(res.users);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load users");
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addUser = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError("");
      setNotice("");
      try {
        await api.createUser({ username, password, role });
        setUsername("");
        setPassword("");
        setRole("user");
        setNotice("User created.");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to create user");
      }
    },
    [api, username, password, role, refresh],
  );

  const removeUser = useCallback(
    async (target: string) => {
      setError("");
      setNotice("");
      try {
        await api.deleteUser(target);
        setNotice(`Deleted ${target}.`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to delete user");
      }
    },
    [api, refresh],
  );

  const changePassword = useCallback(
    async (target: string) => {
      setError("");
      setNotice("");
      try {
        await api.setPassword(target, newPassword);
        setNewPassword("");
        setPwTarget(null);
        setNotice(`Password updated for ${target}.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "failed to change password");
      }
    },
    [api, newPassword],
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Users</h2>
        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {notice ? <p className="text-sm text-green-600">{notice}</p> : null}
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <li key={user.username} className="flex flex-col gap-2 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{user.username}</span>
                  <span className="rounded border px-1.5 py-0.5 text-xs text-muted-foreground">
                    {user.role}
                  </span>
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    className="rounded-md border px-2 py-1 text-xs"
                    onClick={() => {
                      setPwTarget(pwTarget === user.username ? null : user.username);
                      setNewPassword("");
                    }}
                  >
                    Change password
                  </button>
                  <button
                    className="rounded-md border px-2 py-1 text-xs text-red-600"
                    onClick={() => void removeUser(user.username)}
                  >
                    Delete
                  </button>
                </span>
              </div>
              {pwTarget === user.username ? (
                <div className="flex gap-2">
                  <input
                    className="flex-1 rounded-md border px-2 py-1 text-sm"
                    type="password"
                    value={newPassword}
                    placeholder="New password"
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    className="rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
                    onClick={() => void changePassword(user.username)}
                  >
                    Save
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Add user</h2>
        <form className="flex flex-col gap-3" onSubmit={addUser}>
          <input
            className="rounded-md border px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Username"
          />
          <input
            className="rounded-md border px-3 py-2"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
          />
          <label className="flex items-center gap-2 text-sm">
            <span>Role</span>
            <select
              className="rounded-md border px-2 py-1"
              value={role}
              onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "user")}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <button
            type="submit"
            className="self-start rounded-md bg-primary px-4 py-2 text-primary-foreground"
          >
            Add user
          </button>
        </form>
      </section>
    </div>
  );
}

function SearchBar({ onSearch, searching }: { onSearch: (q: string) => void; searching: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSearch(value);
      }}
    >
      <input
        className="flex-1 rounded-md border px-3 py-2"
        placeholder="Search the Internet Archive…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground" disabled={searching}>
        {searching ? "…" : "Search"}
      </button>
    </form>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Album thumbnail. Uses the real cover when one exists; otherwise renders a
 * deterministic colored placeholder from the artist name — looks intentional
 * instead of a broken image or Archive.org's waveform tile.
 */
function AlbumThumb({ client, album }: { client: SubsonicClient; album: Album }) {
  const [failed, setFailed] = useState(false);
  if (album.coverArt && !failed) {
    return (
      <img
        src={client.coverArtUrl(album.coverArt, 80)}
        alt=""
        className="h-12 w-12 rounded object-cover"
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const hue = artistHue(album.artist);
  return (
    <span
      aria-hidden
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded text-xs font-semibold text-white"
      style={{ backgroundColor: `hsl(${hue} 45% 42%)` }}
    >
      {placeholderInitials(album.artist)}
    </span>
  );
}
