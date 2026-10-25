import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** "1 year", "3 years". */
export function yearsLabel(years: number) {
  return `${years} ${years === 1 ? "year" : "years"}`
}
