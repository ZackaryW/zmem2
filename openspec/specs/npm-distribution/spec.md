# npm-distribution Specification

## Purpose

Provide ready-to-use zmem2 installation from Git through npm, including source preparation, revision selection, and isolated verification of the installed command.

## Requirements

### Requirement: Git source installation prepares the command
With supported Node, Git, npm, lifecycle scripts enabled, and development dependencies available, direct global Git installation SHALL prepare a usable zmem command without pre-existing dist or node_modules. Documented installation SHALL target the Git repository rather than the npm registry.

#### Scenario: Install a pinned Git commit
- **WHEN** a user installs a clean Git commit with the documented npm command
- **THEN** npm prepares and installs the CLI and zmem reports the installed package version

#### Scenario: Install the newest source
- **WHEN** a user follows the main installation or upgrade instructions
- **THEN** the command selects the main branch of the Git repository

### Requirement: Checkout setup and recovery are explicit
Lifecycle-enabled checkout dependency installation SHALL build the command before global linking. Scripts-disabled setup SHALL document an explicit build. Preparation failures SHALL fail installation.

#### Scenario: Fresh checkout link
- **WHEN** a user runs npm ci followed by npm link in a clean checkout
- **THEN** the linked command starts without a separate manual build

#### Scenario: Scripts are disabled
- **WHEN** a user installs checkout dependencies with scripts disabled
- **THEN** the instructions require npm run build before using the command

### Requirement: Verification preserves the user's installation
Source-install checks SHALL use isolated prefixes, caches, configuration, and source fixtures. They SHALL verify actual generated launchers and leave the user's global installation untouched.

#### Scenario: Windows direct Git installation
- **WHEN** a clean pinned Git source is installed into an isolated Windows prefix
- **THEN** the generated cmd and PowerShell launchers report the expected version after the original source is unavailable
