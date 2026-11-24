# Town simulation — 70 ideas

The town is a deterministic tick over agents, wants, world events, and memory. These
rows deepen the simulation without turning it into a second product: everything stays
cheap, inspectable, and optional relative to the core orchestrator.

| ID | Idea | What it adds | Where | Effort | Source |
|---|---|---|---|---|---|
| TOWN-001 | Tick determinism tests | Same seed, same wants, same event log must produce the same tick | `tests/` | S | GENAGENTS |
| TOWN-002 | Tick scheduler | Run ticks on a configurable interval with drift correction | `lib/town.mjs` | S | EMERGENT |
| TOWN-003 | Manual tick | A UI button and API route for one tick with a preview of changes | `server.mjs` | S | EMERGENT |
| TOWN-004 | Simulation speed | Pause, 1x, and 4x for demos without changing outcomes | `lib/town.mjs` | S | EMERGENT |
| TOWN-005 | Seeded RNG | One seed per town drives every random choice in a tick | `lib/town.mjs` | S | GENAGENTS |
| TOWN-006 | Agent needs | Each agent has work, rest, and social needs that decay per tick | `lib/town.mjs` | M | EMERGENT |
| TOWN-007 | Energy budget | Low energy reduces claim quality and increases error rates | `lib/town.mjs` | M | EMERGENT |
| TOWN-008 | Mood | A small mood state affected by successes, failures, and events | `lib/town.mjs` | S | EMERGENT |
| TOWN-009 | Skill levels | Per-domain skill scores that grow with completed work | `lib/town.mjs` | M | VOYAGER |
| TOWN-010 | XP and levels | Visible progression tied to real completed wants | `lib/town.mjs` | S | VOYAGER |
| TOWN-011 | Specialization | Agents gradually prefer domains where they succeed | `lib/town.mjs` | M | GENAGENTS |
| TOWN-012 | Learning from work | Completed wants update skill and preference, with a cap per tick | `lib/town.mjs` | M | VOYAGER |
| TOWN-013 | Relationships | Pairwise affinity updated by collaboration and conflict | `lib/town.mjs` | M | GENAGENTS |
| TOWN-014 | Trust edges | A separate trust score used for delegation and gossip credibility | `lib/town.mjs` | M | Invented |
| TOWN-015 | Reputation | Public reputation from fulfilled wants, disputes, and reviews | `lib/town.mjs` | M | EMERGENT |
| TOWN-016 | Gossip events | Agents share recent events, with distortion proportional to trust | `lib/town.mjs` | M | GENAGENTS |
| TOWN-017 | Factions | Emergent groups by shared tags and repeated collaboration | `lib/town.mjs` | L | EMERGENT |
| TOWN-018 | Guilds | Formal groups with membership, dues, and a shared skill focus | `lib/town.mjs` | M | EMERGENT |
| TOWN-019 | Districts | Spatial grouping of buildings and agents with local modifiers | `lib/town.mjs` | M | EMERGENT |
| TOWN-020 | Buildings | Typed structures that unlock actions such as lab, school, or market | `lib/town.mjs` | M | EMERGENT |
| TOWN-021 | Resources | A small set of fungible resources with caps and regeneration | `lib/town.mjs` | M | EMERGENT |
| TOWN-022 | Currency | A town coin used for rewards, wages, and prices | `lib/town.mjs` | M | EMERGENT |
| TOWN-023 | Wages | Agents earn for fulfilled wants and spend on needs | `lib/town.mjs` | M | EMERGENT |
| TOWN-024 | Dynamic prices | Prices move with supply and demand within a bounded range | `lib/town.mjs` | M | EMERGENT |
| TOWN-025 | Market events | Shortages and gluts that change prices for a few ticks | `lib/town.mjs` | S | EMERGENT |
| TOWN-026 | Contracts | Multi-tick commitments with penalties and completion bonuses | `lib/wants.mjs` | M | OPENWANTS |
| TOWN-027 | Quests | Authored multi-step goals that reward specific behaviors | `lib/wants.mjs` | M | EMERGENT |
| TOWN-028 | Achievements | Persistent badges for milestones, shown on agent profiles | `lib/town.mjs` | S | EMERGENT |
| TOWN-029 | Festivals | Scheduled events that boost mood and social interaction | `lib/godmode.mjs` | S | EMERGENT |
| TOWN-030 | Weather effects | Weather modifies travel, mood, and outdoor work | `lib/godmode.mjs` | S | EMERGENT |
| TOWN-031 | Disaster effects | Disasters damage buildings and create urgent wants | `lib/godmode.mjs` | M | EMERGENT |
| TOWN-032 | Blackout effects | Blackouts disable powered buildings until repaired | `lib/godmode.mjs` | S | EMERGENT |
| TOWN-033 | Airdrop effects | Airdrops inject resources with an inflation tradeoff | `lib/godmode.mjs` | S | EMERGENT |
| TOWN-034 | Migration | Unhappy agents may leave and new agents may arrive | `lib/town.mjs` | M | EMERGENT |
| TOWN-035 | Population metrics | Track arrivals, departures, and active agents per tick | `lib/town.mjs` | S | OBS |
| TOWN-036 | Hiring | Agents with open capacity can be hired for a contract | `lib/wants.mjs` | M | OPENWANTS |
| TOWN-037 | Training | Spend resources to raise a skill with diminishing returns | `lib/town.mjs` | M | VOYAGER |
| TOWN-038 | Mentorship | Pair a high-skill and low-skill agent for shared gains | `lib/town.mjs` | M | GENAGENTS |
| TOWN-039 | Shifts | Agents work in shifts so the town never fully sleeps | `lib/town.mjs` | S | EMERGENT |
| TOWN-040 | Day and night | A clock that changes available actions and visuals | `lib/town.mjs` | S | EMERGENT |
| TOWN-041 | Seasons | Longer cycles with different events and resource yields | `lib/town.mjs` | M | EMERGENT |
| TOWN-042 | Town hall | A place where proposals are posted and debated | `lib/town.mjs` | M | EMERGENT |
| TOWN-043 | Proposals | Structured proposals with a cost, effect, and vote window | `lib/town.mjs` | M | EMERGENT |
| TOWN-044 | Voting | Weighted voting by reputation with a quorum and a tie rule | `lib/town.mjs` | M | EMERGENT |
| TOWN-045 | Policies | Enacted rules that change tick behavior and are visible in the UI | `lib/town.mjs` | M | EMERGENT |
| TOWN-046 | Taxes | A small levy on transactions that funds public goods | `lib/town.mjs` | M | EMERGENT |
| TOWN-047 | Public goods | Shared upgrades funded by the treasury | `lib/town.mjs` | M | EMERGENT |
| TOWN-048 | Infrastructure | Roads, power, and network that gate building capacity | `lib/town.mjs` | M | EMERGENT |
| TOWN-049 | Housing | Capacity limits population and affects mood | `lib/town.mjs` | S | EMERGENT |
| TOWN-050 | Health | Illness events that reduce capacity and create care wants | `lib/town.mjs` | M | EMERGENT |
| TOWN-051 | Schools | Buildings that accelerate skill growth | `lib/town.mjs` | S | EMERGENT |
| TOWN-052 | Libraries | Store playbooks and lessons that agents can consult | `lib/town.mjs` | M | AN/skills |
| TOWN-053 | Labs | Unlock experimental capabilities with a failure risk | `lib/town.mjs` | M | EMERGENT |
| TOWN-054 | Power grid | Track generation, demand, and outages per district | `lib/town.mjs` | M | EMERGENT |
| TOWN-055 | Maintenance | Buildings degrade and require scheduled repairs | `lib/town.mjs` | M | EMERGENT |
| TOWN-056 | Crime | Rare theft events that create investigations and warrants | `lib/town.mjs` | M | EMERGENT |
| TOWN-057 | Guards | Agents assigned to patrol reduce crime and cost wages | `lib/town.mjs` | S | EMERGENT |
| TOWN-058 | Courts | Disputes resolved by a judge agent with evidence and a verdict | `lib/town.mjs` | L | EMERGENT |
| TOWN-059 | Fines | Proportional penalties that feed the treasury | `lib/town.mjs` | S | EMERGENT |
| TOWN-060 | Culture | Art, music, and stories created by agents with free capacity | `lib/town.mjs` | M | EMERGENT |
| TOWN-061 | Newspaper | A generated daily paper summarizing real events, with citations | `lib/chronicle.mjs` | M | EMERGENT |
| TOWN-062 | History chronicle | An append-only, human-readable town history | `lib/chronicle.mjs` | S | EMERGENT |
| TOWN-063 | Museum | A gallery of past artifacts, records, and retired agents | `lib/chronicle.mjs` | M | EMERGENT |
| TOWN-064 | Statistics dashboard | Population, happiness, productivity, and treasury over time | `public/app.js` | M | OBS |
| TOWN-065 | Happiness index | A composite of needs, mood, and recent events with a breakdown | `lib/town.mjs` | S | EMERGENT |
| TOWN-066 | Research tree | Unlock town upgrades through accumulated research points | `lib/town.mjs` | L | EMERGENT |
| TOWN-067 | Scenario editor | Save, load, and share a town configuration and seed | `public/app.js` | L | EMERGENT |
| TOWN-068 | External citizens | Let an A2A agent register as a citizen with declared skills and limits | `lib/town.mjs` | L | A2A |
| TOWN-069 | Agent inspector | Click any agent to see skills, relationships, wants, and memory summary | `public/app.js` | M | OBS |
| TOWN-070 | Timeline forking | Fork the town at a tick, change one event, and compare outcomes | `lib/town.mjs` | L | Invented |
