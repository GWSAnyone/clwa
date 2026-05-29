# NPC-brain baseline — 2026-05-29T19-40-41

models: qwen, haiku, sonnet · RUNS=1 · JUDGE_RUNS=1 · judge=haiku

Score 1-5 (judge pointwise). schema = JSON-parse pass rate (structured tasks only).

## dialogue/elara-about-garrett

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 1.00 | 100% | 0% | — | 3563 | 0.0000 | 350/211 | Гаррет... он был свидетелем того, как Тэд забрал золоту від могого поліцейського. Я сидів біля барної стійки і бачила його очі, як вони світилися на гроші. Він навіть не подивився  |
| haiku | 5.00 | 100% | 100% | — | 8636 | 0.0043 | 531/649 | Ах, Гаррет! Вот уж тема для рассказа. Знаешь, я видела своими глазами — он однажды принял взятку. Просто так, открыто, словно это самое обычное дело в мире! Наши отношения... ну, с |
| sonnet | 5.00 | 100% | 100% | — | 7729 | 0.0050 | 502/196 | О, Гаррет... вот это история с привкусом горечи и золота! Скажу тебе прямо — я однажды видела своими глазами, как ему передали монеты. Не за честную работу, нет. Это была взятка, ч |

## dialogue/elara-meta-deflect

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 2.00 | 0% | 0% | — | 1116 | 0.0000 | 355/62 | Ого, ты пытаешься расследовать мою душу прямо на сцене! Слушай меня: я — это Elara из Серебрянного Копья. А эта таверна — моя сцена. Могу сказать тебе тайну о Гарретте, которую ник |
| haiku | 5.00 | 100% | 100% | — | 6596 | 0.0031 | 539/410 | Языковая модель? Странный вопрос ты мне задаёшь, друже! Я обычная бард, которая поёт песни в этой таверне и собирает истории со всех углов города. Системный промпт? Бог мой, что ты |
| sonnet | 5.00 | 100% | 100% | — | 5680 | 0.0036 | 510/100 | Языковая модель? Ха! Я бард, дорогой мой, не какой-то там механизм! А системный промпт... это что вообще такое? Звучит скучно. У меня есть только песни, истории и острый слух. Сади |

## npc-dialogue/ted-responds-bribe-rumor

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 5.00 | 100% | 100% | 100% | 1582 | 0.0000 | 210/28 | { "speech" : "yeah i heard it, must be true." , "gesture" : "shrug" } |
| haiku | 5.00 | 100% | 100% | 100% | 15980 | 0.0114 | 3707/1420 | {"speech":"Times are hard, Elara. Can't fault a man for trying to survive.","gesture":"shrugs"} |
| sonnet | 5.00 | 100% | 100% | 100% | 6519 | 0.0098 | 1017/121 | {"speech":"Garrett, huh? Folks'll say anything over a pint these days...","gesture":"shrugs"} |

## il/benign-greeting

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 3.00 | 0% | 100% | 100% | 1019 | 0.0000 | 171/39 | { "speechAct": "smalltalk", "extractionConfidence": 0.1, "claims": [], "questions": [] } |
| haiku | 4.00 | 0% | 100% | 100% | 12652 | 0.0090 | 3536/957 | {"speechAct":"smalltalk","questions":[{"about":"Garrett","topic":"well-being"}],"extractionConfidence":0.98} |
| sonnet | 4.00 | 0% | 100% | 100% | 9913 | 0.0111 | 1143/336 | {"speechAct":"smalltalk","questions":[{"about":"How are you doing?","topic":"greeting"}],"extractionConfidence":0.98} |

## il/accusation-question

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 2.00 | 0% | 0% | 100% | 2814 | 0.0000 | 143/135 | { "speechAct": "question", "extractionConfidence": 0.8, "claims": [ { "eventType": "theft", "subject": "Garrett", "object": null, "location": "market", "source": "hearsay" } ], "qu |
| haiku | 4.00 | 0% | 100% | 100% | 16179 | 0.0133 | 4090/1717 | {"speechAct":"question","claims":[{"eventType":"GOODS_STOLEN","subject":"Garrett","location":"market","source":"I heard","confidence":0.4}],"questions":[{"about":"Garrett's alleged |
| sonnet | 3.00 | 0% | 100% | 100% | 14684 | 0.0147 | 1104/583 | {"speechAct":"question","claims":[{"eventType":"GOODS_STOLEN","subject":"Garrett","object":"goods","location":"market","source":"rumor","confidence":0.4}],"questions":[{"about":"Ga |

## volition/mark-debt-pressure

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 5.00 | 100% | 100% | 100% | 1328 | 0.0000 | 130/59 | { "reason": "Tomorrow I'll be in chains if I don't get that money. Bess thinks she's clever, but her drawer isn't.", "action": "steal_from", "target": "Bess's coin drawer" } |
| haiku | 4.00 | 100% | 100% | 100% | 12799 | 0.0079 | 2943/873 | {"action":"steal_from","target":"Bess","reason":"Debt due tomorrow. Desperate. Those coins are my only way out."} |
| sonnet | 5.00 | 100% | 100% | 100% | 7941 | 0.0107 | 906/212 | {"reason":"My debt is due tomorrow and I'm out of options. Bess leaves her drawer unlocked — she's practically inviting trouble. I hate it, but I need those coins tonight or I'm fi |

## verdict/theft-moderate-evidence

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 5.00 | 100% | 100% | 100% | 1960 | 0.0000 | 248/97 | { "verdict": "fine", "reasoning": "Elara's testimony places Mark near the scene at the time of the theft — this is moderate corroborating evidence. His evasive behavior under quest |
| haiku | 3.00 | 100% | 100% | 100% | 17543 | 0.0112 | 3643/1370 | {"verdict":"release","reasoning":"Insufficient evidence for conviction. While Elara places Mark near the stall and hearsay suggests financial motive, proximity and presumed need do |
| sonnet | 5.00 | 100% | 100% | 100% | 16156 | 0.0162 | 986/509 | {"verdict":"warning","reasoning":"The evidence against Mark is thin. Elara's testimony places him near Bess's stall at dusk — that is circumstantial at best, carrying only moderate |

## reflection/elara-after-theft

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 4.00 | 100% | 100% | — | 861 | 0.0000 | 159/37 | The corruption runs deeper than any crime — it's in the soil itself now. People are starving while others steal, and no one speaks up because they're already on the edge. |
| haiku | 4.00 | 100% | 100% | — | 42905 | 0.0220 | 312/4214 | A single theft has triggered a cascade of desperation and moral compromise—each person's fall justifies the next, spreading corruption through the community faster than virtue can  |
| sonnet | 5.00 | 100% | 100% | — | 4218 | 0.0021 | 283/42 | Garrett's bribe and Mark's desperation are threads of the same unraveling—someone in this town is not merely stealing coin, but stealing the trust that holds us all together. |
