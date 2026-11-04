# NOTICE

`plugins/superagent` (npm package `@sredevopsorg/dsh-superagent`) is a fork of
the DeepSeek Harness research prototype **dsh-superagent**:

- Upstream repository: <https://github.com/deepseek-ai/dsh-superagent-prototype>
- Upstream commit: `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`
  ("feat: add the dsh-superagent research prototype")
- Upstream package version: `0.1.0`
- Upstream license: MIT
- Copyright (c) 2026 DeepSeek Harness Team

The upstream MIT license text is retained in [`LICENSE`](LICENSE), including its
copyright notice and permission notice. This fork keeps that text unchanged.

The fork republishes the upstream source tree as a versioned plugin in the
sredevopsorg/dsh-plugins repository. The modifications are package metadata
(scoped package name, repository/homepage/bugs, bundle row specifiers, DSH
version ranges), locating packaged assets under the scoped package name, the
client module id, a committed `lib/` build so the Git dependency installs
without a build step, and this attribution. Upstream documentation is vendored
unchanged and still describes the plugin.
