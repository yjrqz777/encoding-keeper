# Change Log

All notable changes to the "encoding-keeper" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.0.7] - 2026-07-08

- Improve transcoding behavior by decoding valid UTF-8 source bytes before writing the target encoding.
- Close open editor tabs before converting files, then reopen the active file with the target encoding.
- Add repository contributor guidelines in `AGENTS.md`.
