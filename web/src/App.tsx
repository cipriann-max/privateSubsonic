import { useCallback, useEffect, useRef, useState } from "react";
import { SubsonicClient, type Album, type Track } from "./lib/subsonic";

/**
 * Minimal web player: login → search → album → play.
 * The bar: search for a recording, hit play, it plays.
 */

const CREDS_KEY = "privatesubsonic.creds";

interface Creds {
  username: string;
  password: string;
}

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
  const [creds, setCreds] = useState<Creds | null>(loadCreds);
  const [client, setClient] = useState<SubsonicClient | null>(null);
  const [query, setQuery] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedAlbum, setSelectedAlbum] = useState<Album | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [status, setStatus] = useState<string>("");
  const [searching, setSearching] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (creds) {
      setClient(new SubsonicClient(creds));
    }
  }, [creds]);

  const handleLogin = useCallback((username: string, password: string) => {
    const next = new SubsonicClient({ username, password });
    void next.ping().then((ok) => {
      if (ok) {
        localStorage.setItem(CREDS_KEY, JSON.stringify({ username, password }));
        setCreds({ username, password });
        setClient(next);
      } else {
        setStatus("Login failed: wrong username or password.");
      }
    });
  }, []);

  const handleSearch = useCallback(
    async (q: string) => {
      if (!client) return;
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
      if (!client) return;
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

  const playTrack = useCallback(
    (track: Track) => {
      if (!client) return;
      setNowPlaying(track);
      // The <audio> src is set declaratively from nowPlaying; browsers will
      // start playing once we call play().
      requestAnimationFrame(() => {
        void audioRef.current?.play().catch(() => {
          setStatus("Playback blocked by the browser — press play.");
        });
      });
    },
    [client],
  );

  if (!client) {
    return <Login onLogin={handleLogin} status={status} />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">privateSubsonic</h1>
        <button
          className="rounded-md border px-3 py-1.5 text-sm"
          onClick={() => {
            localStorage.removeItem(CREDS_KEY);
            setCreds(null);
            setClient(null);
          }}
        >
          Log out
        </button>
      </header>

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
              {album.coverArt ? (
                <img
                  src={client.coverArtUrl(album.coverArt, 80)}
                  alt=""
                  className="h-12 w-12 rounded object-cover"
                  loading="lazy"
                />
              ) : null}
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

      {nowPlaying && client ? (
        <footer className="sticky bottom-0 border-t bg-background/95 p-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <audio ref={audioRef} controls className="w-full" src={client.streamUrl(nowPlaying.id)} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {nowPlaying.artist} — {nowPlaying.title}
          </p>
        </footer>
      ) : null}
    </div>
  );
}

function Login({ onLogin, status }: { onLogin: (u: string, p: string) => void; status: string }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
      <h1 className="text-2xl font-semibold tracking-tight">privateSubsonic</h1>
      <p className="text-sm text-muted-foreground">
        Sign in with the server's admin credentials.
      </p>
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