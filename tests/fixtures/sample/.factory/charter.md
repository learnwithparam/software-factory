# Charter

A deliberately small repository, used to test the factory against something that is not the demo.

If the factory's own tests ran only against the demo codebase, they would prove the factory works on
one repository. This fixture exists so they prove it reads whatever it is pointed at.

## Tier

`TIER: supervised`

## Autonomy, per target

Levels live in `.factory/targets.json`.

## Protected paths

```protected
secrets/**            # credentials, and nothing an agent does here is recoverable
.factory/charter.md   # limits an agent can edit are not limits
```

## Stop conditions

`STOP_IF: awaiting_review >= 2`

## What a person still does

Decides what merges.
