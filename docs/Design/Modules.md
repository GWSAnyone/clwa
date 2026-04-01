# Module System

One engine, many modules. Each module adds affordances, CG rules, and topic sources to existing locations.

## Current: Crime & Justice
**Status**: Implemented (v0.10.0)

Adds: steal, kill, blackmail, investigate, arrest, trial, sentence, flee, destroy evidence, intimidate witness, testify, report crime, demand justice, confront, gossip, grieve, lay low, seek forgiveness, socialize + evaluate case

See [[../GDD_DETECTIVE.md]] for game design.

## Planned: Economy
**Status**: Design phase

Would add: trade, barter, smuggle, bribe (expanded), debt collection, price manipulation, shop management

Affordances: buy, sell, smuggle, counterfeit, collect_debt, invest, bankrupt
CG rules: GOODS_TRADED → price shift, DEBT_UNPAID → collector arrives, SMUGGLING_DISCOVERED → investigation
Topic sources: priceTopics, debtTopics, tradeRouteTopics

## Planned: Politics
**Status**: Concept

Would add: factions, laws, elections, corruption, alliances, coups

Affordances: propose_law, vote, campaign, bribe_official, form_alliance, stage_coup
CG rules: LAW_PASSED → behavior changes, ELECTION_WON → power shift, COUP_ATTEMPTED → civil conflict

## Planned: Combat
**Status**: Concept

Would add: weapons, armor, wounds, territory, duels, mercenary contracts

## Planned: Social
**Status**: Partially exists (socialize affordance, topic engine)

Would expand: marriages, families, celebrations, feuds, courtship, rumors about relationships
