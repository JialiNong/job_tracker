"use client";
/**
 * Page state kept in the URL query (shareable, survives reload, Back works).
 * A value equal to its default is left out of the URL.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function useQueryParams<T extends Record<string, string>>(defaults: T) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const values = Object.fromEntries(
    Object.entries(defaults).map(([key, fallback]) => [key, params.get(key) ?? fallback]),
  ) as T;
  const set = (patch: Partial<Record<keyof T, string | null>>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined || value === defaults[key]) next.delete(key);
      else next.set(key, value as string);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return [values, set, params] as const;
}
