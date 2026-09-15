# Loofta Nest — onboarding flow (Next.js)

## Files
- `onboarding.css` — tokens + flow styles (shares the `.ns-*` palette vars with nest-splash). Import once in your layout.
- `OnboardingFlow.tsx.txt` — rename to `OnboardingFlow.tsx` after copying (the `.txt` suffix keeps it out of this kit's own build). Client component, no deps.

## Usage
```tsx
// app/onboarding/page.tsx
import OnboardingFlow from "./OnboardingFlow";
import "./onboarding.css";

export default function Page() {
  return <OnboardingFlow onComplete={(answers) => {
    // answers: { goal, horizon, drop, persona, control, themes[], rules, monthlyLimit, avoid[] }
    // -> persist to your API, then route to the starter portfolio
  }} />;
}
```

## Behavior
- Fully responsive: single column, full-width buttons and ≥44px targets under 480px — same component serves desktop and mobile.
- Picking an answer auto-advances (350ms); back button on every question.
- Vibe (Steady Era / Balanced Builder / Long-Term Mode / Big Swing Energy / Still Figuring It Out) derives from Q4.
- `onComplete` fires on "Build my nest" and "Skip for now" (skip returns whatever was picked).
- Logo path: `/logo/loofta.svg` — point at your public asset.
