# Security policy

## Reporting

Email **hello@agent360.dk**, or open a private advisory at
https://github.com/Agent360dk/computerMCP/security/advisories.

If you find a way past one of the three gates described in the
[security model](https://computermcp.dev/security.html), that is precisely what
we want to hear about. Please tell us before it is public; we will credit you
when it is fixed unless you would rather we didn't.

## Scope

In scope:

- Reading a secure text field through a screenshot that claimed to be redacted
- Performing a write action without the consent the mode requires
- Getting an always-ask app (password manager, terminal) to act without a dialog
- Making an expired or dismissed dialog resolve as approval
- Clear-text secrets appearing in the audit log
- Command injection through any argument that reaches the helper binary
- Sending a message in a messaging app through this server without the person
  seeing who it goes to and what it says, and approving that one message

Out of scope, and documented as such:

- A secret visible on screen that macOS does not mark as secure (a password in a
  text editor, a token in a terminal buffer). We redact what the system marks.
- Anything an agent does after a human has approved the session - consent is not
  containment, and the README says so before you install.
- Prompt injection that leads to an action the user then approves.
- macOS permissions being held by the host app rather than by this package.
- Sends that never pass through this server: browser automation, `osascript`,
  or any other tool your client allows. The send port guards this server's own
  calls; your client's permissions decide the rest.

## Supported versions

The latest release on npm. This project is pre-1.0; fixes go forward, not back.
