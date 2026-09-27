# Third-party notices

## Google Myanmar Tools Zawgyi detector and converter

`packages/core/src/detection/google-zawgyi-model.ts` adapts the Zawgyi detector
algorithm and embeds the trained model from Google Myanmar Tools 1.2.0.
`packages/core/src/conversion/google-zawgyi-rules.ts` and
`packages/core/src/conversion/convert-myanmar-encoding.ts` adapt its generated
CLDR-derived Zawgyi conversion rules and engine.
`corpus/encoding/conversion-v1.json` includes its 126 data-driven conversion
fixtures.

Source: [google/myanmar-tools](https://github.com/google/myanmar-tools), version
1.2.0.

Copyright 2017 Google LLC.

Licensed under the Apache License, Version 2.0. You may obtain a copy of the
license at <https://www.apache.org/licenses/LICENSE-2.0>.

The adapted component and bundled model remain subject to Apache-2.0. The rest
of MyanLex remains subject to the repository's MIT License unless stated
otherwise.

## Rabbit conversion sample corpus

`corpus/encoding/conversion-v1.json` includes eight conversion pairs from
[Rabbit](https://github.com/Rabbit-Converter/Rabbit) at commit
`081d464a91ab4dde14b799a54d1e89dde55b438e`.

Rabbit is licensed under the Do What The Fuck You Want To Public License,
Version 2 (WTFPL). The original license is available in the
[Rabbit repository](https://github.com/Rabbit-Converter/Rabbit/blob/081d464a91ab4dde14b799a54d1e89dde55b438e/LICENSE.md).
