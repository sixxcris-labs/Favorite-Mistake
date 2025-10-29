# 🚀 Throwie Quality & Security Setup Guide

## 📦 What's Included

This setup provides enterprise-grade code quality, security, and automation for your Throwie project.

### ✅ Features

- **Code Quality**: ESLint + Prettier with strict TypeScript
- **Security Scanning**: Snyk + Semgrep + Dependabot
- **CI/CD**: GitHub Actions workflows
- **Git Hooks**: Pre-commit checks with Husky
- **Static Analysis**: SonarCloud integration
- **Dependency Management**: Automated updates with Dependabot
- **VSCode Integration**: Optimized settings and extensions

---

## 📁 File Structure

```
.
├── .github/
│   ├── workflows/
│   │   └── quality.yml          # Main CI/CD workflow
│   └── dependabot.yml           # Automated dependency updates
│
├── .husky/
│   ├── pre-commit               # Pre-commit git hook
│   └── commit-msg               # Commit message validation
│
├── .vscode/
│   ├── settings.json            # VSCode settings
│   └── extensions.json          # Recommended extensions
│
├── .eslintrc.js                 # ESLint configuration
├── .prettierrc.js               # Prettier configuration
├── .prettierignore              # Prettier ignore rules
├── sonar-project.properties     # SonarCloud configuration
├── tsconfig.strict.json         # Strict TypeScript config
└── package.json                 # Updated with quality scripts
```

---

## 🚀 Quick Start (10 Minutes)

### Step 1: Copy Files to Your Project

```bash
# Copy all configuration files to your project root
cp -r .github /path/to/Throwie/
cp -r .husky /path/to/Throwie/
cp -r .vscode /path/to/Throwie/
cp .eslintrc.js /path/to/Throwie/
cp .prettierrc.js /path/to/Throwie/
cp .prettierignore /path/to/Throwie/
cp sonar-project.properties /path/to/Throwie/
cp tsconfig.strict.json /path/to/Throwie/

# Update your package.json with the new scripts
# (merge the scripts section from our package.json into yours)
```

### Step 2: Install Dependencies

```bash
cd /path/to/Throwie

# Install dev dependencies
pnpm add -D \
  @typescript-eslint/eslint-plugin@^6.21.0 \
  @typescript-eslint/parser@^6.21.0 \
  eslint@^8.56.0 \
  eslint-config-prettier@^9.1.0 \
  eslint-plugin-import@^2.29.1 \
  eslint-plugin-jsx-a11y@^6.8.0 \
  eslint-plugin-react@^7.33.2 \
  eslint-plugin-react-hooks@^4.6.0 \
  eslint-plugin-security@^2.1.0 \
  prettier@^3.2.5 \
  husky@^9.0.10 \
  lint-staged@^15.2.2

# Initialize Husky
pnpm exec husky install

# Make hooks executable
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
```

### Step 3: Configure GitHub Secrets

You'll need to add these secrets to your GitHub repository:

1. Go to: `Settings` → `Secrets and variables` → `Actions`
2. Add the following secrets:

| Secret | How to Get It |
|--------|---------------|
| `SNYK_TOKEN` | Sign up at [snyk.io](https://snyk.io) → Account Settings → API Token |
| `SONAR_TOKEN` | Sign up at [sonarcloud.io](https://sonarcloud.io) → My Account → Security → Generate Token |
| `CODECOV_TOKEN` | Sign up at [codecov.io](https://codecov.io) → Add Repository → Copy Token |

### Step 4: Update Configuration Files

#### Update `sonar-project.properties`:
```properties
sonar.projectKey=YOUR-ORG_throwie
sonar.organization=YOUR-ORG
```

#### Update `.github/dependabot.yml`:
```yaml
reviewers:
  - "your-github-username"
```

### Step 5: Test the Setup

```bash
# Run all quality checks
pnpm quality

# This should run:
# - ESLint
# - Prettier check
# - TypeScript type check
# - Tests
```

---

## 🎯 Available Commands

### Code Quality

```bash
# Run ESLint
pnpm lint

# Fix ESLint issues
pnpm lint:fix

# Check Prettier formatting
pnpm format:check

# Format code with Prettier
pnpm format

# TypeScript type check
pnpm type-check

# Run all quality checks
pnpm quality

# Fix all quality issues
pnpm quality:fix
```

### Security

```bash
# Run pnpm audit
pnpm security

# Run Snyk scan
pnpm security:snyk

# Run Semgrep scan
pnpm security:semgrep
```

### Testing

```bash
# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage
```

---

## 🔧 GitHub Actions Workflows

### Quality Workflow (`.github/workflows/quality.yml`)

**Runs on:** Every push and pull request to `main` or `develop`

**Jobs:**
1. **Lint & Format** - ESLint, Prettier, TypeScript checks
2. **Security Scan** - pnpm audit, Snyk, Semgrep
3. **Dependency Review** - Reviews new dependencies (PRs only)
4. **SonarCloud** - Code quality analysis
5. **Build Check** - Verifies project builds
6. **Test & Coverage** - Runs tests and uploads coverage
7. **CodeQL** - Advanced security analysis
8. **Quality Gate** - Summary of all checks

**What it does:**
- ✅ Catches code quality issues
- ✅ Identifies security vulnerabilities
- ✅ Ensures code builds
- ✅ Verifies tests pass
- ✅ Blocks PRs that don't meet standards

---

## 🤖 Dependabot Configuration

### What it does:
- Automatically checks for dependency updates weekly
- Creates pull requests for outdated packages
- Groups related updates together
- Updates GitHub Actions monthly

### Configuration:
- **Schedule**: Weekly on Mondays at 9 AM
- **Max open PRs**: 10 for dependencies, 3 for GitHub Actions
- **Auto-labels**: `dependencies`, `automated`

---

## 🎨 Code Quality Rules

### ESLint Rules

**TypeScript:**
- ✅ No unused variables
- ✅ Strict null checks
- ✅ No floating promises
- ✅ Proper async/await usage

**Security:**
- ⚠️ Detects unsafe object injection
- ⚠️ Flags unsafe regex
- ⚠️ Identifies timing attacks
- ❌ Blocks eval usage

**Imports:**
- 📦 Alphabetically sorted
- 📦 Grouped by type (builtin, external, internal)
- 📦 Newline between groups

### Prettier Rules

- **Print Width**: 100 characters
- **Indentation**: 2 spaces
- **Quotes**: Single quotes
- **Semicolons**: Always
- **Trailing Commas**: ES5
- **Line Endings**: LF (Unix)

### TypeScript Strict Mode

All strict checks enabled:
- ✅ `strict: true`
- ✅ `noImplicitAny: true`
- ✅ `strictNullChecks: true`
- ✅ `noUnusedLocals: true`
- ✅ `noUncheckedIndexedAccess: true`

---

## 🔒 Security Scanning

### Snyk
- Scans for known vulnerabilities in dependencies
- Checks against Snyk's vulnerability database
- Blocks high-severity issues

### Semgrep
- Static analysis for code security
- Detects common security patterns
- OWASP Top 10 coverage

### Dependabot
- Monitors security advisories
- Auto-creates PRs for security patches
- Alerts for vulnerable dependencies

### CodeQL
- Advanced semantic code analysis
- Detects complex security issues
- Identifies data flow vulnerabilities

---

## 📊 SonarCloud Integration

### What SonarCloud Analyzes:

1. **Code Quality**
   - Code smells
   - Technical debt
   - Maintainability issues

2. **Security**
   - Security hotspots
   - Vulnerabilities
   - Security ratings

3. **Coverage**
   - Test coverage
   - Line coverage
   - Branch coverage

4. **Duplications**
   - Duplicated code blocks
   - Copy-paste detection

### Quality Gates:

- **Code Coverage**: > 80%
- **Duplicated Code**: < 3%
- **Maintainability Rating**: A
- **Security Rating**: A
- **Reliability Rating**: A

---

## 🎣 Git Hooks (Husky)

### Pre-commit Hook

**Runs before every commit:**
1. Lint-staged (formats and lints changed files)
2. TypeScript type check

**What it does:**
- Formats code with Prettier
- Fixes ESLint issues
- Checks types
- Prevents committing broken code

### Commit Message Hook

**Validates commit messages:**

**Required format:**
```
type(scope?): message

Examples:
✅ feat(api): add story endpoint
✅ fix: resolve bug in story display
✅ docs: update README
✅ chore(deps): update dependencies
```

**Valid types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation
- `style` - Code style changes
- `refactor` - Code refactoring
- `test` - Adding tests
- `chore` - Maintenance
- `perf` - Performance improvements
- `ci` - CI/CD changes
- `build` - Build system changes
- `revert` - Revert previous commit

---

## 🔧 VSCode Integration

### Automatic Features:

1. **Format on Save** - Code formatted automatically
2. **ESLint Auto-fix** - Issues fixed on save
3. **Organize Imports** - Imports sorted on save
4. **TypeScript Workspace** - Uses project TypeScript version

### Recommended Extensions:

**Essential:**
- ESLint
- Prettier
- TypeScript

**Code Quality:**
- Code Spell Checker
- Error Lens
- Import Cost

**Git:**
- GitLens
- Git Graph

**Productivity:**
- Todo Tree
- ES7 React Snippets

---

## 🐛 Troubleshooting

### ESLint Errors on Import

**Problem:** `Unable to resolve path to module`

**Solution:**
```bash
pnpm install
# Restart VSCode
```

### Prettier Not Formatting

**Problem:** Code doesn't format on save

**Solution:**
1. Install Prettier extension
2. Set as default formatter
3. Enable format on save in settings

### Husky Hooks Not Running

**Problem:** Commits succeed without running checks

**Solution:**
```bash
# Reinstall Husky
pnpm exec husky install
chmod +x .husky/pre-commit
chmod +x .husky/commit-msg
```

### GitHub Actions Failing

**Problem:** Workflow fails with secrets error

**Solution:**
1. Add required secrets to GitHub
2. Check secret names match exactly
3. Verify tokens are valid

---

## 📈 Monitoring & Reports

### Where to View Results:

1. **GitHub Actions** - `/actions` tab in your repo
2. **SonarCloud** - `sonarcloud.io/projects`
3. **Snyk** - `app.snyk.io`
4. **Codecov** - `codecov.io/gh/your-org/throwie`

### Quality Metrics to Track:

- ✅ Build success rate
- ✅ Test coverage percentage
- ✅ Code quality grade (A-F)
- ✅ Security rating
- ✅ Technical debt ratio
- ✅ Dependency health

---

## 🎓 Best Practices

### 1. Run Quality Checks Locally

```bash
# Before pushing
pnpm quality
```

### 2. Fix Issues Immediately

```bash
# Auto-fix what can be fixed
pnpm quality:fix
```

### 3. Review Security Alerts

- Check Dependabot PRs weekly
- Review Snyk alerts immediately
- Update dependencies regularly

### 4. Monitor Code Coverage

- Aim for > 80% coverage
- Write tests for new features
- Review coverage reports

### 5. Keep Dependencies Updated

- Review Dependabot PRs
- Update manually if needed
- Test thoroughly after updates

---

## 🚀 Next Steps

1. ✅ Install and configure all tools
2. ✅ Set up GitHub secrets
3. ✅ Run first quality check
4. ✅ Fix any issues
5. ✅ Commit and push
6. ✅ Watch CI/CD run
7. ✅ Review reports

**Your project now has enterprise-grade quality and security! 🎉**

---

## 📚 Resources

- [ESLint Docs](https://eslint.org/docs/latest/)
- [Prettier Docs](https://prettier.io/docs/en/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Snyk Docs](https://docs.snyk.io/)
- [SonarCloud Docs](https://docs.sonarcloud.io/)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Husky Docs](https://typicode.github.io/husky/)

---

**Built with ❤️ for Throwie**

*Questions? Check the troubleshooting section or open an issue!*
