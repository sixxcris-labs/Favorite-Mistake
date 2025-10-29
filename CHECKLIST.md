# ✅ Throwie Quality & Security Setup Checklist

Use this checklist to ensure everything is properly configured.

## 📦 Installation

- [ ] Copy all configuration files to project root
- [ ] Install dev dependencies (`pnpm add -D ...`)
- [ ] Initialize Husky (`pnpm exec husky install`)
- [ ] Make hooks executable (`chmod +x .husky/*`)
- [ ] Install VSCode recommended extensions

## 🔐 GitHub Secrets

- [ ] Sign up for Snyk account
- [ ] Add `SNYK_TOKEN` to GitHub secrets
- [ ] Sign up for SonarCloud account
- [ ] Add `SONAR_TOKEN` to GitHub secrets
- [ ] Sign up for Codecov account
- [ ] Add `CODECOV_TOKEN` to GitHub secrets

## ⚙️ Configuration

- [ ] Update `sonar-project.properties` with your org/project
- [ ] Update `.github/dependabot.yml` with your GitHub username
- [ ] Update root `package.json` with new scripts
- [ ] Merge VSCode settings (if you have existing settings)

## 🧪 Testing

- [ ] Run `pnpm lint` - should pass or show fixable issues
- [ ] Run `pnpm format:check` - should pass
- [ ] Run `pnpm type-check` - should pass
- [ ] Run `pnpm test` - should pass
- [ ] Run `pnpm quality` - all checks should pass
- [ ] Make a test commit - hooks should run
- [ ] Push to GitHub - Actions should run

## 📊 Service Setup

- [ ] Visit SonarCloud and verify project appears
- [ ] Visit Snyk and verify project is scanned
- [ ] Check GitHub Actions tab for workflow runs
- [ ] Verify Dependabot is creating PRs (may take a week)

## 🎨 VSCode Setup

- [ ] Open project in VSCode
- [ ] Install recommended extensions when prompted
- [ ] Verify format on save works
- [ ] Verify ESLint errors show in editor
- [ ] Check that TypeScript errors appear

## ✅ Final Checks

- [ ] Create a test branch
- [ ] Make a small change
- [ ] Commit with valid message format
- [ ] Pre-commit hooks run successfully
- [ ] Push and create PR
- [ ] All GitHub Actions checks pass
- [ ] Review reports in SonarCloud
- [ ] Check security scan results in Snyk

## 📝 Optional Enhancements

- [ ] Set up CodeSee for architecture visualization
- [ ] Enable GitHub branch protection rules
- [ ] Configure required status checks for PRs
- [ ] Set up Slack/Discord notifications
- [ ] Add coverage badges to README
- [ ] Create CONTRIBUTING.md with quality guidelines

## 🎓 Team Onboarding

- [ ] Share SETUP_GUIDE.md with team
- [ ] Document commit message format
- [ ] Explain pre-commit hooks
- [ ] Train team on fixing ESLint errors
- [ ] Review quality metrics together

## 🔧 Maintenance

- [ ] Review Dependabot PRs weekly
- [ ] Check security alerts immediately
- [ ] Update dependencies monthly
- [ ] Review code quality trends
- [ ] Adjust rules as needed

---

## ⚡ Quick Commands Reference

```bash
# Quality checks
pnpm quality          # Run all checks
pnpm quality:fix      # Fix what can be fixed
pnpm lint             # ESLint only
pnpm format           # Format code
pnpm type-check       # TypeScript check

# Security
pnpm security         # Run security scans
pnpm audit            # Check for vulnerabilities

# Git
git commit -m "feat: add feature"  # Valid format
git commit -m "added feature"      # Invalid - will be rejected
```

---

## 🎯 Success Criteria

Your setup is complete when:

✅ All commits trigger pre-commit hooks
✅ Invalid commit messages are rejected
✅ GitHub Actions run on every push
✅ SonarCloud shows your project
✅ Snyk scans for vulnerabilities
✅ VSCode formats on save
✅ ESLint errors show in editor
✅ All quality commands pass

---

## 🆘 Common Issues

### Hooks not running?

```bash
pnpm exec husky install
chmod +x .husky/*
```

### ESLint errors everywhere?

```bash
pnpm lint:fix
pnpm format
```

### GitHub Actions failing?

- Check secrets are set
- Verify token permissions
- Review action logs

### SonarCloud not working?

- Verify SONAR_TOKEN is set
- Check project key in properties file
- Ensure organization is correct

---

**Done? Congrats! Your project now has enterprise-grade quality! 🎉**

Save this checklist and revisit when onboarding new team members.
