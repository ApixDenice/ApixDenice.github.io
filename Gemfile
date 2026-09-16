source "https://rubygems.org"

# Mirrors the exact Jekyll + plugin versions GitHub Pages uses in production,
# so `bundle exec jekyll serve` renders locally what the live site renders.
gem "github-pages", group: :jekyll_plugins

# Ruby 3+ no longer bundles webrick, which `jekyll serve` needs.
gem "webrick", "~> 1.8"

platforms :mingw, :x64_mingw, :mswin, :jruby do
  gem "tzinfo", ">= 1", "< 3"
  gem "tzinfo-data"
end
gem "wdm", "~> 0.1.1", :platforms => [:mingw, :x64_mingw, :mswin]
