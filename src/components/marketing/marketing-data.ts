import { Bug, Droplets, Fan, Hammer, House, Leaf, Paintbrush, Sparkles, Waves, Wrench, Zap } from "lucide-react";

export const serviceCategories = [
  { id: "outdoor", name: "Outdoor Care", description: "Keep your property healthy, clean, and inviting.", icon: Leaf },
  { id: "cleaning", name: "Cleaning", description: "Reliable recurring and deep-cleaning services.", icon: Sparkles },
  { id: "systems", name: "Home Systems", description: "Essential maintenance from qualified local professionals.", icon: Wrench },
  { id: "improvements", name: "Repairs & Improvements", description: "Skilled help for the projects on your list.", icon: House },
] as const;

export const services = [
  { id: "lawn-care", name: "Lawn Care", category: "outdoor", description: "Mowing, edging, trimming, and a tidy finish.", oneTime: 55, recurring: 45, unit: "/visit", icon: Leaf, popular: true },
  { id: "pool-service", name: "Pool Service", category: "outdoor", description: "Routine cleaning, chemistry checks, and equipment inspection.", oneTime: 95, recurring: 149, unit: "/month", icon: Waves, popular: true },
  { id: "pressure-washing", name: "Pressure Washing", category: "outdoor", description: "Refresh driveways, lanais, walkways, and exterior surfaces.", oneTime: 149, recurring: 0, unit: "", icon: Droplets, popular: false },
  { id: "pest-control", name: "Pest Control", category: "outdoor", description: "Targeted treatment and preventative home protection.", oneTime: 119, recurring: 49, unit: "/month", icon: Bug, popular: false },
  { id: "house-cleaning", name: "House Cleaning", category: "cleaning", description: "A dependable whole-home clean tailored to your space.", oneTime: 139, recurring: 119, unit: "/visit", icon: Sparkles, popular: true },
  { id: "deep-cleaning", name: "Deep Cleaning", category: "cleaning", description: "Detailed top-to-bottom care for high-touch and overlooked areas.", oneTime: 249, recurring: 0, unit: "", icon: Sparkles, popular: false },
  { id: "hvac-maintenance", name: "HVAC Maintenance", category: "systems", description: "Seasonal tune-ups that keep your system running efficiently.", oneTime: 129, recurring: 0, unit: "", icon: Fan, popular: true },
  { id: "electrical", name: "Electrical Service", category: "systems", description: "Troubleshooting, fixture installation, and minor electrical work.", oneTime: 129, recurring: 0, unit: "", icon: Zap, popular: false },
  { id: "handyman", name: "Handyman", category: "improvements", description: "Repairs, installations, assembly, and punch-list projects.", oneTime: 99, recurring: 0, unit: "", icon: Hammer, popular: true },
  { id: "painting", name: "Painting", category: "improvements", description: "Interior and exterior painting with a clear scoped quote.", oneTime: 0, recurring: 0, unit: "", icon: Paintbrush, popular: false },
] as const;

export const providers = [
  { id: "coastal-lawn", name: "Coastal Lawn & Landscape", category: "outdoor", location: "Cape Coral", rating: 4.9, jobs: 286, years: 9, description: "Dependable weekly lawn care with photo-confirmed completion.", services: ["Lawn Care", "Hedge Trimming", "Yard Cleanup"] },
  { id: "gulf-pool", name: "Gulfside Pool Professionals", category: "outdoor", location: "Fort Myers", rating: 4.8, jobs: 194, years: 12, description: "Residential pool care built around consistency and clear updates.", services: ["Pool Service", "Chemical Balancing", "Filter Cleaning"] },
  { id: "sunshine-clean", name: "Sunshine Home Cleaning", category: "cleaning", location: "Cape Coral", rating: 5, jobs: 163, years: 6, description: "Careful, friendly home cleaning for busy households and seasonal residents.", services: ["House Cleaning", "Deep Cleaning", "Move-In Cleaning"] },
  { id: "caloosa-air", name: "Caloosa Air & Electric", category: "systems", location: "Fort Myers", rating: 4.9, jobs: 118, years: 15, description: "Licensed home-system specialists focused on responsive service.", services: ["HVAC Maintenance", "Electrical Service", "Diagnostics"] },
  { id: "harbor-handyman", name: "Harbor Home Solutions", category: "improvements", location: "Cape Coral", rating: 4.8, jobs: 142, years: 11, description: "A versatile, insured team for repairs and small improvement projects.", services: ["Handyman", "Fixture Installation", "Painting"] },
  { id: "palm-paint", name: "Palm & Pine Painting", category: "improvements", location: "Fort Myers", rating: 4.9, jobs: 97, years: 8, description: "Clean prep, clear communication, and polished interior and exterior finishes.", services: ["Interior Painting", "Exterior Painting", "Touch-ups"] },
] as const;
