# Project instructions

## benchmark/

Never run, execute, or invoke anything in `benchmark/` (its CLI, scripts, tests, or any
ad-hoc script that talks to it) unless the user explicitly asks for it in that conversation.
Do not proactively run it as part of validating an unrelated change, "just to check," or as
part of routine testing. Treat it as out of scope by default — skip past it in searches and
task planning unless the user's request is specifically about it.
