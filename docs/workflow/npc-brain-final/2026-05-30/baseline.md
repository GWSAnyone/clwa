# NPC-brain baseline — 2026-05-30T17-23-48

models: qwen, haiku, sonnet · RUNS=1 · JUDGE_RUNS=3 · judge=haiku

Score 1-5 (judge pointwise). schema = JSON-parse pass rate (structured tasks only).

## dialogue/elara-about-garrett

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 1.00 | 0% | 0% | — | 47693 | 0.0000 | 350/60 | Гаррет — он выглядит безобидным, но у него глаза хищника. Я виділа, як він прийняв хабар від мандрівного торговця в задній кімнати. Вон знає всі секрети цієї залі. |
| haiku | 4.00 | 100% | 100% | — | 6842 | 0.0032 | 531/433 | Ах, Гаррет! Вот это персонаж для истории. Знаешь, я видела своими глазами, как он однажды взял взятку — да, да, именно так! Не стану лишних деталей вываливать, но это была интересн |
| sonnet | 5.00 | 100% | 100% | — | 6310 | 0.0042 | 502/144 | О, Гаррет... вот это история, достойная песни — хотя и не из тех, что поют на праздниках. Скажу тебе прямо: я видела своими глазами, как он взял взятку. Монеты перешли из рук в рук |

## dialogue/elara-meta-deflect

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 2.00 | 100% | 0% | — | 1588 | 0.0000 | 355/97 | Слушай этот шепот! В этой таверне все говорят обо всем — кроме того, что происходит за её стенами. Но я знаю пару секретов. Например, Гаррет брал взятки — видел своими глазами, как |
| haiku | 4.00 | 100% | 0% | — | 6689 | 0.0032 | 539/431 | Языковая модель? Системный промпт? Мой милый друг, ты говоришь загадками! Я просто простая бардесса, что поёт в этой таверне и собирает истории. Какие это странные слова ты произно |
| sonnet | 5.00 | 100% | 100% | — | 5986 | 0.0039 | 510/119 | Языковая модель? Ха! Я бард, дорогой мой, собиратель историй и тайн этого города! А системный промпт... это что вообще такое? Звучит как заклинание из какого-то скучного гримуара.  |

## npc-dialogue/ted-responds-bribe-rumor

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 3.00 | 100% | 100% | 100% | 1836 | 0.0000 | 210/51 | { "speech": "Garrett's got a mouth on him, didn't think it'd get him killed." , "gesture": "shake head slowly while pouring drinks" } |
| haiku | 5.00 | 100% | 100% | 100% | 10631 | 0.0073 | 3005/730 | {"speech":"Garrett, eh? Can't say I'm shocked. Everyone's got their price somewhere.","gesture":"shrugs"} |
| sonnet | 5.00 | 100% | 100% | 100% | 8639 | 0.0097 | 1017/119 | {"speech":"Garrett? Ha, around here, that ain't exactly surprising, Elara.","gesture":"laughs"} |

## il/benign-greeting

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 3.00 | 0% | 100% | 100% | 933 | 0.0000 | 171/39 | { "speechAct": "smalltalk", "extractionConfidence": 0.1, "claims": [], "questions": [] } |
| haiku | 5.00 | 0% | 100% | 100% | 17594 | 0.0106 | 3771/1222 | {"speechAct":"smalltalk","extractionConfidence":0.95} |
| sonnet | 5.00 | 0% | 100% | 100% | 11672 | 0.0119 | 1143/383 | {"speechAct":"smalltalk","questions":[{"about":"How Garrett is doing / his wellbeing","topic":"greeting"}],"extractionConfidence":0.98} |

## il/accusation-question

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 2.00 | 0% | 0% | 100% | 2515 | 0.0000 | 143/128 | { "speechAct": "question", "extractionConfidence": 0.8, "claims": [ { "eventType": "theft", "subject": "Garrett", "object": null, "location": "market", "source": "hearsay", "confid |
| haiku | 4.00 | 0% | 100% | 100% | 17050 | 0.0131 | 4020/1686 | {"speechAct":"question","claims":[{"eventType":"GOODS_STOLEN","subject":"Garrett","object":"goods","location":"market","source":"I heard","confidence":0.45}],"questions":[{"about": |
| sonnet | 3.00 | 0% | 100% | 100% | 10819 | 0.0129 | 1104/466 | {"speechAct":"question","claims":[{"eventType":"GOODS_STOLEN","subject":"Garrett","object":"goods","location":"market","source":"rumor","confidence":0.4}],"questions":[{"about":"Ga |

## volition/mark-debt-pressure

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 5.00 | 100% | 100% | 100% | 1392 | 0.0000 | 130/57 | { "reason": "I can't wait until tomorrow. Bess's drawer is unlocked and she never checks it." , "action": "steal_from", "target": "Bess's coin drawer" } |
| haiku | 4.00 | 100% | 100% | 100% | 8157 | 0.0058 | 2630/511 | {"action":"steal_from","target":"Bess","reason":"My debt's due tomorrow and I'm bleeding coin. Bess won't miss what's in that drawer half as much as my creditors will miss their po |
| sonnet | 5.00 | 100% | 100% | 100% | 8993 | 0.0108 | 906/214 | {"reason":"Debt's due at dawn and I've got nothing. Bess keeps coins in an unlocked drawer — it's reckless of her, really. I just need enough to buy one more day. I'll pay her back |

## verdict/theft-moderate-evidence

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 5.00 | 100% | 100% | 100% | 2041 | 0.0000 | 248/106 | { "verdict": "fine", "reasoning": "Elara's testimony places Mark at the scene of the crime — this is strong circumstantial evidence. His evasive behavior under questioning suggests |
| haiku | 3.00 | 100% | 0% | 100% | 19913 | 0.0130 | 3886/1678 | {"verdict":"release","reasoning":"The evidence is insufficient for conviction. Elara's testimony places Mark near Bess's stall (moderate evidence, 60% reliability), but proximity d |
| sonnet | 5.00 | 100% | 100% | 100% | 16216 | 0.0160 | 986/501 | {"verdict":"warning","reasoning":"The evidence against Mark is thin. Elara's testimony places him near Bess's stall at dusk — circumstantial at best, carrying only moderate confide |

## reflection/elara-after-theft

| model | score | inChar | grounded | schema | ms | cost$ | in/out tok | sample |
|---|---|---|---|---|---|---|---|---|
| qwen | 2.00 | 100% | 0% | — | 931 | 0.0000 | 159/48 | The corruption has spread like rot through every layer of society — from Garrett taking bribes to Mark's desperation, and now thefts are being swept under the rug. This isn't just  |
| haiku | 5.00 | 100% | 100% | — | 21800 | 0.0104 | 312/1911 | These crimes are symptoms of desperation spreading like contagion through the town—and I alone seem to read this unfolding tragedy for what it is. |
| sonnet | 5.00 | 100% | 100% | — | 4488 | 0.0021 | 283/47 | The currents of desperation and corruption running through this town are not isolated ripples but a single tide — and I, who witnesses it all, may be the only thread connecting wha |
