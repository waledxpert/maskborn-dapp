"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { PixelArtwork } from "@/components/pixel-artwork";
import { DotLoader } from "@/components/dot-loader";
import { apiFetch } from "@/lib/api";
import { Pagination } from "@/components/pagination";

type GalleryEntry = {
  id: string;
  kind: "ONE_OF_ONE" | "TRAIT";
  categories: string[];
  previewAssetUrl: string;
  submission: {
    title: string;
    slug: string;
    previewAssetUrl: string;
    upvoteCount: number;
    downvoteCount: number;
    publishedAt: string;
    user: {
      displayName: string | null;
      socialAccounts: Array<{ username: string }>;
    };
  };
};

const filters = ["All work", "1/1", "Background", "Fur", "Eyes", "Ears", "Tails", "Masks", "Hats", "Special"];

export function GalleryBrowser() {
  const [filter, setFilter] = useState("All work");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("Newest");
  const [page, setPage] = useState(1);
  const gallery = useQuery({
    queryKey: ["gallery"],
    queryFn: () => apiFetch<{ items: GalleryEntry[] }>("/gallery"),
    retry: false,
  });
  const entries = useMemo(() => {
    const items = gallery.data?.items ?? [];
    const normalized = search.trim().toLowerCase();
    const filtered = items.filter((entry) => {
      const username = entry.submission.user.socialAccounts[0]?.username ?? "";
      const categoryMatch = filter === "All work"
        || (filter === "1/1" ? entry.kind === "ONE_OF_ONE" : entry.categories.includes(filter.toUpperCase()));
      const searchMatch = !normalized
        || `${entry.submission.title} ${entry.submission.user.displayName ?? ""} ${username}`.toLowerCase().includes(normalized);
      return categoryMatch && searchMatch;
    });
    if (sort === "Highest likes") filtered.sort((a, b) => b.submission.upvoteCount - a.submission.upvoteCount);
    else if (sort === "Highest score") {
      filtered.sort((a, b) =>
        (b.submission.upvoteCount - b.submission.downvoteCount)
        - (a.submission.upvoteCount - a.submission.downvoteCount));
    } else if (sort === "A-Z") filtered.sort((a, b) => a.submission.title.localeCompare(b.submission.title));
    else filtered.sort((a, b) => Date.parse(b.submission.publishedAt) - Date.parse(a.submission.publishedAt));
    return filtered;
  }, [filter, gallery.data, search, sort]);

  const pageSize = 12;
  const pages = Math.max(1, Math.ceil(entries.length / pageSize));
  const visibleEntries = entries.slice((Math.min(page, pages) - 1) * pageSize, Math.min(page, pages) * pageSize);

  return (
    <section className="gallery-shell shell">
      <div className="gallery-filters" aria-label="Gallery categories">
        {filters.map((item) => (
          <button key={item} className={filter === item ? "active" : ""} onClick={() => { setFilter(item); setPage(1); }}>{item}</button>
        ))}
      </div>
      <div className="filter-row gallery-toolbar">
        <label className="filter-search">
          <Search size={15} />
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search accepted artwork or creator" />
        </label>
        <label className="select-wrap">
          <span className="sr-only">Sort accepted artwork</span>
          <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}>
            <option>Newest</option>
            <option>Highest likes</option>
            <option>Highest score</option>
            <option>A-Z</option>
          </select>
          <ChevronDown size={15} />
        </label>
      </div>
      <div className="gallery-grid">
        {visibleEntries.map((entry, index) => {
          const username = entry.submission.user.socialAccounts[0]?.username;
          const creator = username ? `@${username}` : entry.submission.user.displayName ?? "Mask Born member";
          return (
            <article className={`gallery-item gallery-item-${(index % 6) + 1}`} key={entry.id}>
              <div className="gallery-art-wrap">
                  <PixelArtwork source={entry.previewAssetUrl} label={entry.submission.title} eager={index === 0} />
                  <span>{String((Math.min(page, pages) - 1) * pageSize + index + 1).padStart(2, "0")}</span>
              </div>
              <div className="gallery-item-meta">
                <div><p>{entry.kind === "ONE_OF_ONE" ? "1/1" : entry.categories.join(" + ")}</p><h2>{entry.submission.title}</h2></div>
                {username ? (
                  <a href={`https://x.com/${username}`} target="_blank" rel="noreferrer">
                    {creator}<ArrowUpRight size={14} />
                  </a>
                ) : <span>{creator}</span>}
              </div>
            </article>
          );
        })}
      </div>
      <Pagination
        page={Math.min(page, pages)}
        pages={pages}
        onPageChange={(nextPage) => {
          setPage(nextPage);
          document.querySelector(".gallery-shell")?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
      />
      {gallery.isLoading && <DotLoader label="Loading accepted work" />}
      {gallery.isError && <div className="empty-state">The gallery could not be loaded. Try again shortly.</div>}
      {!gallery.isLoading && !gallery.isError && entries.length === 0 && (
        <div className="empty-state">{(gallery.data?.items.length ?? 0) === 0 ? "No community work has been accepted yet." : "No accepted work matches this filter."}</div>
      )}
    </section>
  );
}
