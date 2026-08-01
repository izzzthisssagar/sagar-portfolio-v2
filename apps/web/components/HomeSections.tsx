import Link from 'next/link';
import { notes, projects } from '@/lib/content';
import { SystemCanvas } from './SystemCanvas';
export function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="container hero-grid">
        <div>
          <p className="eyebrow">Sagar Thapa / Quality Engineer</p>
          <h1 id="hero-title" className="display" aria-label="I turn assumptions into evidence.">
            I turn
            <br />
            assumptions
            <br />
            into evidence.
          </h1>
          <p className="lede">
            I investigate interfaces, business rules, APIs, security, accessibility, and performance
            to uncover failures before release.
          </p>
          <div className="actions">
            <Link className="button primary" href="/work">
              INSPECT MY WORK
            </Link>
            <span className="button" aria-disabled="true" title="CV has not yet been supplied">
              DOWNLOAD CV — PENDING
            </span>
          </div>
          <p className="capline">
            MANUAL QA / API TESTING / SECURITY / PERFORMANCE / AUTOMATION / TEST ARCHITECTURE /
            PRODUCT QUALITY
          </p>
          <p>
            Rupandehi, Nepal
            <br />
            Available for QA and software opportunities
          </p>
        </div>
        <div className="system-wrap">
          <SystemCanvas state="sealed" />
        </div>
      </div>
    </section>
  );
}
export function EvidenceSection() {
  return (
    <section className="section" aria-labelledby="evidence-title">
      <div className="container">
        <div className="section-head">
          <p className="eyebrow">01 / Evidence</p>
          <h2 id="evidence-title">Below the interface.</h2>
        </div>
        <p className="lede">
          Quality is a connected system. An interface can look correct while business rules,
          identity, state, security, or performance fail beneath it.
        </p>
        <div className="evidence-grid">
          {[
            'Interface',
            'Business logic',
            'API & authentication',
            'Data & state',
            'Security & performance',
          ].map((x) => (
            <div className="evidence-item" key={x}>
              {x}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function QAMasterySection() {
  const p = projects[0]!;
  return (
    <section className="section" aria-labelledby="mastery-title">
      <div className="container">
        <div className="section-head">
          <p className="eyebrow">02 / Flagship</p>
          <h2 id="mastery-title">QA Mastery becomes a system.</h2>
        </div>
        <p className="lede">
          QA Mastery is an independently conceived and directed product by Sagar Thapa. I am the
          sole human creator and product owner, responsible for the product vision, requirements,
          architecture decisions, testing direction, iterative evaluation, and release decisions. I
          used substantial AI coding assistance during research, implementation, debugging,
          documentation, and refinement. The platform remains under active development.
        </p>
        <div className="metrics">
          {p.metrics.map((m) => (
            <div className="metric" key={m.label}>
              <strong>{m.value}</strong>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
        <p>
          Platform / Curriculum / Interactive Widgets / Automated Grading / BuggyShop / BuggyAPI /
          AI Tutor / Supabase / CI & Release Gate
        </p>
        <div className="actions">
          <a className="button primary" href="https://qa-mastery-platform.vercel.app/">
            VIEW LIVE
          </a>
          <a className="button" href="https://github.com/izzzthisssagar/qa-mastery">
            GITHUB
          </a>
          <Link className="button" href="/work/qa-mastery">
            CASE STUDY
          </Link>
        </div>
      </div>
    </section>
  );
}
export function ProjectIndex() {
  return (
    <section className="section" aria-labelledby="projects-title">
      <div className="container">
        <div className="section-head">
          <p className="eyebrow">03 / Work</p>
          <h2 id="projects-title">Every project opens a different layer.</h2>
        </div>
        <ol className="project-list">
          {projects.map((p) => (
            <li className="project-row" key={p.id}>
              <Link href={`/work/${p.slug}`}>
                <span>{p.id}</span>
                <strong>{p.title}</strong>
                <span>{p.summary}</span>
                <span aria-hidden>↗</span>
              </Link>
            </li>
          ))}
        </ol>
        <p>
          Project preview media is pending review. No screenshot is presented as evidence until
          supplied and approved.
        </p>
      </div>
    </section>
  );
}
export function MethodSection() {
  const stages = [
    ['MODEL', 'Understand the system, users, requirements, data, and risk.'],
    ['BREAK', 'Explore invalid states, boundaries, failure paths, and assumptions.'],
    ['TRACE', 'Isolate the failing layer and document evidence.'],
    ['VERIFY', 'Retest the correction and protect against regression.'],
  ];
  return (
    <section className="section" aria-labelledby="method-title">
      <div className="container">
        <div className="section-head">
          <p className="eyebrow">04 / Method</p>
          <h2 id="method-title">Model. Break. Trace. Verify.</h2>
        </div>
        <div className="method">
          {stages.map(([name, text], i) => (
            <article className="stage" key={name}>
              <span>0{i + 1}</span>
              <div>
                <strong>{name}</strong>
                <p>{text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
export function FieldNotesSection() {
  return (
    <section className="section" aria-labelledby="notes-title">
      <div className="container">
        <div className="section-head">
          <p className="eyebrow">05 / Field Notes</p>
          <h2 id="notes-title">Evidence, written down.</h2>
        </div>
        <div className="notes">
          {notes.map((n) => (
            <article className="note" key={n.slug}>
              <p className="eyebrow">Draft seed / {n.readingTime} min</p>
              <h3>
                <Link href={`/notes/${n.slug}`}>{n.title}</Link>
              </h3>
              <p>{n.excerpt}</p>
            </article>
          ))}
        </div>
        <p>
          LinkedIn Dispatches will be curated through the CMS using public post URLs. Automatic
          personal-feed scraping is intentionally excluded.
        </p>
      </div>
    </section>
  );
}
export function AboutSection() {
  return (
    <section className="section" aria-labelledby="about-title">
      <div className="container about">
        <div
          className="portrait-placeholder"
          role="img"
          aria-label="Portrait placeholder — approved portrait pending"
        >
          <p>
            PORTRAIT ASSET PENDING
            <br />
            <small>Expected: /assets/images/portrait/sagar-portrait.png</small>
          </p>
        </div>
        <div>
          <p className="eyebrow">06 / About</p>
          <h2 id="about-title">A tester who also builds the systems he wishes existed.</h2>
          {[
            ['Testing', 'Functional / Exploratory / Regression / Accessibility'],
            ['API', 'Postman / Swagger / REST / Authentication / Negative testing'],
            ['Performance', 'JMeter / Percentiles / Bottleneck analysis'],
            ['Automation', 'Selenium / Java / Playwright foundations'],
            ['Engineering', 'Git / GitHub Actions / SQL / REST APIs / CI/CD'],
          ].map(([a, b]) => (
            <div className="capability" key={a}>
              <strong>{a}</strong>
              <span>{b}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
export function QARiftTeaser() {
  return (
    <section className="section rift" aria-labelledby="rift-title">
      <div className="container">
        <p className="eyebrow">07 / QA Rift</p>
        <h2 id="rift-title">The release is unstable.</h2>
        <p className="lede">
          A separate quality game for visual, logic, API, accessibility, performance, security, and
          release challenges. It never loads on the homepage.
        </p>
        <Link className="button" href="/lab/qa-rift">
          ENTER THE LAB
        </Link>
      </div>
    </section>
  );
}
export function ContactFooter() {
  return (
    <footer className="footer" id="contact">
      <div className="container footer-grid">
        <div>
          <p className="eyebrow">08 / Contact</p>
          <h2>Build the evidence before release.</h2>
        </div>
        <div>
          <p>Rupandehi, Nepal</p>
          <Link className="button primary" href="/contact">
            CONTACT SAGAR
          </Link>
        </div>
      </div>
    </footer>
  );
}
