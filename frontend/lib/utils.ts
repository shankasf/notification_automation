/**
 * Shared utility functions used across the frontend.
 *
 * Includes:
 *  - cn(): Tailwind class merging (clsx + tailwind-merge)
 *  - formatCurrency/formatRate: locale-aware USD formatting
 *  - formatDate/formatDateTime: human-readable date strings
 *  - getInitials: extract initials from a full name for avatars
 *  - calculatePercentage: safe percentage with zero-division guard
 */
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merges Tailwind classes with proper precedence handling (via tailwind-merge). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formats a number as USD with no decimals (e.g., $1,234,567). */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/** Formats a number as USD with 2 decimals (e.g., $125.50 for hourly rates). */
export function formatRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Formats a date as "Jan 15, 2025" (short month, no time). */
export function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Formats a date with time as "Jan 15, 2025, 02:30 PM". */
export function formatDateTime(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Extracts uppercase initials from a full name (e.g., "Sarah Chen" -> "SC"). */
export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase();
}

/** Calculates percentage with zero-division guard, rounded to nearest integer. */
export function calculatePercentage(part: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((part / total) * 100);
}
