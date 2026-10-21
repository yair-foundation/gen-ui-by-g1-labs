# Contributing to Gen UI

Thanks for helping. Gen UI is a curated library: the agent picks from the catalog and never writes components at runtime, so each component is its contract (a Zod schema, guidance, a tool definition and a typed result). Changes are judged on that basis.

## Before you start

- For a new component or a schema change, open an issue first. Say what the user is trying to do and why no existing component covers it.
- Read the component's page on https://gen-ui-kit.vercel.app and its `<name>.schema.ts`: the guidance (`useWhen`, `avoidWhen`, rules) is part of the contract.
- Visual changes reuse the shared primitives in `src/components/genui/` (`Surface`, `genuiType`, `genuiMotion`, series colours) rather than one-off sizes or colours.

## Component contract

- Props are partial while streaming. Host props are `status`, `onResult`, `result` (restores a finished state without re-firing) and `className`.
- Results are a closed set of actions. Fields that must come from a tool are marked `DATA-BOUND` in their `.describe()`.
- Numbers, money and dates format in the host's locale from `useGenUILocale()`, never the runtime's.
- Lifecycle states (failed, stale, expired, superseded, empty, partial, cancelled) belong to the Renderer, not to components.
- Accessibility is part of the component: labels, focus rings, tap targets, live regions.

## Before you open a pull request

```bash
pnpm typecheck
pnpm test
pnpm registry:build
```

`pnpm lint` (Biome) runs but doesn't pass across the codebase yet; keep the files you touch clean.

Add or update tests in the component's `__tests__/` folder, and update its entry in `registry.json` if you add files.

## Assets and data

- Only add images, icons, fonts or logos you have the right to redistribute under the MIT license, and say where they came from in the pull request.
- Example data may be invented, but facts stated about a real person, place or company must be accurate.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
