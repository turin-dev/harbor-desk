## Summary

Describe the behavior change and why it is needed.

## Validation

- [ ] Targeted tests or checks were run
- [ ] Full checks were run when practical
- [ ] Documentation was updated when behavior or a boundary changed
- [ ] Unverified external, packaged, or deployment checks are called out

## Security checklist

- [ ] No real secrets, host-specific details, certificates, tokens, or logs
      were added
- [ ] The renderer still has no direct Docker Engine access
- [ ] Gateway authorization and host grants remain server-side
- [ ] Docker socket use, if touched, is still server-side, explicitly
      privileged, and never presented as a production isolation boundary

## Screenshots or recording

Attach redacted visual evidence for user-interface changes when useful.
