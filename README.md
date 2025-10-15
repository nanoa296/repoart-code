# repoart-code

This repo manages the automation that creates a picture in contributions by way of the `repoart` repo.

## why

because giving a shit about contribution count is idiot shit for idiots

## how

1. The `template.sh` is just a pile of 2019-dated commits from the original [GitHub Painter](https://github-painter.vercel.app/) by [mattrltrent](https://github.com/mattrltrent/github_painter).
2. `remap-rolling.js` scrubs the template, aligns it to the current rolling window, and shifts it a couple columns left so there’s breathing room.
3. A GitHub Action in this repo runs daily: it builds the remapped script, checks out the `repoart` repo, wipes the `art-rolling` branch, replays the commits, drops a README, and force-pushes the result.
