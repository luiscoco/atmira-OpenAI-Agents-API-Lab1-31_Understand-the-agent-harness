import { useEffect, useState } from 'react';
import Lab1 from './Lab1.tsx';
import Lab2 from './Lab2.tsx';
import Lab3 from './Lab3.tsx';
import Lab4 from './Lab4.tsx';
import Lab5 from './Lab5.tsx';
import Lab6 from './Lab6.tsx';
import Lab7 from './Lab7.tsx';
import Lab8 from './Lab8.tsx';
import Lab9 from './Lab9.tsx';
import Lab10 from './Lab10.tsx';
import Lab11 from './Lab11.tsx';
import Lab12 from './Lab12.tsx';
import Lab13 from './Lab13.tsx';
import Lab14 from './Lab14.tsx';
import Lab15 from './Lab15.tsx';
import Lab16 from './Lab16.tsx';
import Lab17 from './Lab17.tsx';
import Lab18 from './Lab18.tsx';
import Lab19 from './Lab19.tsx';
import Lab20 from './Lab20.tsx';
import Lab21 from './Lab21.tsx';
import Lab22 from './Lab22.tsx';
import Lab23 from './Lab23.tsx';
import Lab24 from './Lab24.tsx';
import Lab25 from './Lab25.tsx';
import Lab26 from './Lab26.tsx';
import Lab27 from './Lab27.tsx';
import Lab28 from './Lab28.tsx';
import Lab29 from './Lab29.tsx';
import Lab30 from './Lab30.tsx';
import Lab31 from './Lab31.tsx';
import Lab32 from './Lab32.tsx';
import openaiIcon from './assets/openai.svg';
import authorPortrait from './assets/author-portrait.png';

function SidebarChevron({ open }: { open: boolean }) {
  return <svg className={'sidebar-chevron' + (open ? ' open' : '')} viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 7 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

const labIds = Array.from({ length: 32 }, (_, index) => `lab${index + 1}`);
// The open lab is kept in the URL hash, so a reload returns to it (Lab 13 relies on this).
const initialLab = () => (typeof window !== 'undefined' && labIds.includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'home');

export default function App() {
  const [activeLab, setActiveLab] = useState(initialLab);
  const [lab2Feature, setLab2Feature] = useState('conversation');
  const [foundationsOpen, setFoundationsOpen] = useState(false);
  const [typescriptOpen, setTypescriptOpen] = useState(false);
  const [streamingOpen, setStreamingOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [hostedOpen, setHostedOpen] = useState(false);
  const [harnessOpen, setHarnessOpen] = useState(false);
  const [lab2Open, setLab2Open] = useState(false);
  const [health, setHealth] = useState(null);

  useEffect(() => { window.history.replaceState(null, '', `#${activeLab}`); }, [activeLab]);

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then(setHealth)
      .catch(() => setHealth({ configured: false, model: 'unknown' }));
  }, []);

  return (
    <div className={'app-shell' + (activeLab === 'home' ? ' home-shell' : '')}>
      <aside className="sidebar">
        <button type="button" className="brand brand-button" onClick={() => setActiveLab('home')} aria-label="Open home page"><span className="brand-mark"><img src={openaiIcon} alt="" /></span><span className="brand-copy">OpenAI Agents API Labs<small>THE LEARNING SERIES</small></span></button>
        <button type="button" className="sidebar-section-toggle" aria-expanded={foundationsOpen} aria-controls="foundations-menu" onClick={() => setFoundationsOpen((open) => !open)}><span>FOUNDATIONS</span><SidebarChevron open={foundationsOpen} /></button>
        {foundationsOpen ? <nav id="foundations-menu" className="sidebar-menu" aria-label="Foundation labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab1' ? ' selected' : '')} aria-current={activeLab === 'lab1' ? 'page' : undefined} onClick={() => setActiveLab('lab1')}><span className="nav-number">01</span><span className="sidebar-item-copy"><strong>Create your first agent</strong><small>Agent · Session · Run</small></span></button>
          <div className={'sidebar-lab-group' + (activeLab === 'lab2' ? ' selected' : '')}>
            <button type="button" className="sidebar-lab sidebar-lab-parent" onClick={() => { setActiveLab('lab2'); setLab2Open(true); }}><span className="nav-number">02</span><span className="sidebar-item-copy"><strong>Continue &amp; customize</strong><small>Conversation · Instructions</small></span></button>
            <button type="button" className="sidebar-subtoggle" aria-label={lab2Open ? 'Collapse Lab 02 lessons' : 'Expand Lab 02 lessons'} aria-expanded={lab2Open} aria-controls="lab2-lessons" onClick={() => setLab2Open((open) => !open)}><SidebarChevron open={lab2Open} /></button>
            {lab2Open ? <div id="lab2-lessons" className="sidebar-lessons">
              <button type="button" className={'sidebar-lesson' + (activeLab === 'lab2' && lab2Feature === 'conversation' ? ' selected' : '')} aria-current={activeLab === 'lab2' && lab2Feature === 'conversation' ? 'page' : undefined} onClick={() => { setActiveLab('lab2'); setLab2Feature('conversation'); }}><span className="nav-number">1</span><span className="sidebar-item-copy"><strong>Continue a conversation</strong><small>LESSON 1</small></span></button>
              <button type="button" className={'sidebar-lesson' + (activeLab === 'lab2' && lab2Feature === 'instructions' ? ' selected' : '')} aria-current={activeLab === 'lab2' && lab2Feature === 'instructions' ? 'page' : undefined} onClick={() => { setActiveLab('lab2'); setLab2Feature('instructions'); }}><span className="nav-number">2</span><span className="sidebar-item-copy"><strong>Customize instructions</strong><small>LESSON 2</small></span></button>
            </div> : null}
          </div>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab3' ? ' selected' : '')} aria-current={activeLab === 'lab3' ? 'page' : undefined} onClick={() => setActiveLab('lab3')}><span className="nav-number">03</span><span className="sidebar-item-copy"><strong>Inspect the lifecycle</strong><small>Event inspector</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab4' ? ' selected' : '')} aria-current={activeLab === 'lab4' ? 'page' : undefined} onClick={() => setActiveLab('lab4')}><span className="nav-number">04</span><span className="sidebar-item-copy"><strong>Handle interrupted work</strong><small>Recovery</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab5' ? ' selected' : '')} aria-current={activeLab === 'lab5' ? 'page' : undefined} onClick={() => setActiveLab('lab5')}><span className="nav-number">05</span><span className="sidebar-item-copy"><strong>Manage sessions</strong><small>History</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={typescriptOpen} aria-controls="typescript-menu" onClick={() => setTypescriptOpen((open) => !open)}><span>TYPESCRIPT &amp; CONFIGURATION</span><SidebarChevron open={typescriptOpen} /></button>
        {typescriptOpen ? <nav id="typescript-menu" className="sidebar-menu" aria-label="TypeScript and configuration labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab6' ? ' selected' : '')} aria-current={activeLab === 'lab6' ? 'page' : undefined} onClick={() => setActiveLab('lab6')}><span className="nav-number">06</span><span className="sidebar-item-copy"><strong>Move to TypeScript</strong><small>Typed events</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab7' ? ' selected' : '')} aria-current={activeLab === 'lab7' ? 'page' : undefined} onClick={() => setActiveLab('lab7')}><span className="nav-number">07</span><span className="sidebar-item-copy"><strong>Save and reuse an agent</strong><small>Named tutor preset</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab8' ? ' selected' : '')} aria-current={activeLab === 'lab8' ? 'page' : undefined} onClick={() => setActiveLab('lab8')}><span className="nav-number">08</span><span className="sidebar-item-copy"><strong>Override one session</strong><small>Session instructions</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab9' ? ' selected' : '')} aria-current={activeLab === 'lab9' ? 'page' : undefined} onClick={() => setActiveLab('lab9')}><span className="nav-number">09</span><span className="sidebar-item-copy"><strong>Compare models &amp; reasoning</strong><small>Quality · Latency</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab10' ? ' selected' : '')} aria-current={activeLab === 'lab10' ? 'page' : undefined} onClick={() => setActiveLab('lab10')}><span className="nav-number">10</span><span className="sidebar-item-copy"><strong>Design an output contract</strong><small>Validate · Repair</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={streamingOpen} aria-controls="streaming-menu" onClick={() => setStreamingOpen((open) => !open)}><span>STREAMING &amp; REACT</span><SidebarChevron open={streamingOpen} /></button>
        {streamingOpen ? <nav id="streaming-menu" className="sidebar-menu" aria-label="Streaming and React labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab11' ? ' selected' : '')} aria-current={activeLab === 'lab11' ? 'page' : undefined} onClick={() => setActiveLab('lab11')}><span className="nav-number">11</span><span className="sidebar-item-copy"><strong>Render text events</strong><small>Deltas · Done parts</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab12' ? ' selected' : '')} aria-current={activeLab === 'lab12' ? 'page' : undefined} onClick={() => setActiveLab('lab12')}><span className="nav-number">12</span><span className="sidebar-item-copy"><strong>Build a turn timeline</strong><small>Events · Turns · Order</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab13' ? ' selected' : '')} aria-current={activeLab === 'lab13' ? 'page' : undefined} onClick={() => setActiveLab('lab13')}><span className="nav-number">13</span><span className="sidebar-item-copy"><strong>Recover after a disconnect</strong><small>Reattach · Saved items</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab14' ? ' selected' : '')} aria-current={activeLab === 'lab14' ? 'page' : undefined} onClick={() => setActiveLab('lab14')}><span className="nav-number">14</span><span className="sidebar-item-copy"><strong>Cancel and steer a turn</strong><small>Cancel · Steer · Outcome</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab15' ? ' selected' : '')} aria-current={activeLab === 'lab15' ? 'page' : undefined} onClick={() => setActiveLab('lab15')}><span className="nav-number">15</span><span className="sidebar-item-copy"><strong>Show usage and duration</strong><small>Tokens · Time · Errors</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={toolsOpen} aria-controls="tools-menu" onClick={() => setToolsOpen((open) => !open)}><span>FUNCTION TOOLS &amp; HUMAN CONTROL</span><SidebarChevron open={toolsOpen} /></button>
        {toolsOpen ? <nav id="tools-menu" className="sidebar-menu" aria-label="Function tools and human control labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab16' ? ' selected' : '')} aria-current={activeLab === 'lab16' ? 'page' : undefined} onClick={() => setActiveLab('lab16')}><span className="nav-number">16</span><span className="sidebar-item-copy"><strong>Declare a function tool</strong><small>Name · Description · Schema</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab17' ? ' selected' : '')} aria-current={activeLab === 'lab17' ? 'page' : undefined} onClick={() => setActiveLab('lab17')}><span className="nav-number">17</span><span className="sidebar-item-copy"><strong>Complete a required action</strong><small>Pause · Run · Tool result</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab18' ? ' selected' : '')} aria-current={activeLab === 'lab18' ? 'page' : undefined} onClick={() => setActiveLab('lab18')}><span className="nav-number">18</span><span className="sidebar-item-copy"><strong>Validate tool inputs</strong><small>Schema · Timeout · Errors</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab19' ? ' selected' : '')} aria-current={activeLab === 'lab19' ? 'page' : undefined} onClick={() => setActiveLab('lab19')}><span className="nav-number">19</span><span className="sidebar-item-copy"><strong>Connect a read-only service</strong><small>Live API · Narrow · Grounded</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab20' ? ' selected' : '')} aria-current={activeLab === 'lab20' ? 'page' : undefined} onClick={() => setActiveLab('lab20')}><span className="nav-number">20</span><span className="sidebar-item-copy"><strong>Approve a write action</strong><small>Pause · Decide · Audit</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={searchOpen} aria-controls="search-menu" onClick={() => setSearchOpen((open) => !open)}><span>SEARCH, MCP &amp; PLUGINS</span><SidebarChevron open={searchOpen} /></button>
        {searchOpen ? <nav id="search-menu" className="sidebar-menu" aria-label="Search, MCP, and plugin labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab21' ? ' selected' : '')} aria-current={activeLab === 'lab21' ? 'page' : undefined} onClick={() => setActiveLab('lab21')}><span className="nav-number">21</span><span className="sidebar-item-copy"><strong>Add web search</strong><small>Search · Cite · Check</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab22' ? ' selected' : '')} aria-current={activeLab === 'lab22' ? 'page' : undefined} onClick={() => setActiveLab('lab22')}><span className="nav-number">22</span><span className="sidebar-item-copy"><strong>Connect a public MCP server</strong><small>Discover · Call · Ground</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab23' ? ' selected' : '')} aria-current={activeLab === 'lab23' ? 'page' : undefined} onClick={() => setActiveLab('lab23')}><span className="nav-number">23</span><span className="sidebar-item-copy"><strong>Restrict MCP tools</strong><small>Origin · Allowlist · Probe</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab24' ? ' selected' : '')} aria-current={activeLab === 'lab24' ? 'page' : undefined} onClick={() => setActiveLab('lab24')}><span className="nav-number">24</span><span className="sidebar-item-copy"><strong>Private MCP authentication</strong><small>Vault · Credential · Rotate</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab25' ? ' selected' : '')} aria-current={activeLab === 'lab25' ? 'page' : undefined} onClick={() => setActiveLab('lab25')}><span className="nav-number">25</span><span className="sidebar-item-copy"><strong>Package a reusable plugin</strong><small>Skill · MCP · Template</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={hostedOpen} aria-controls="hosted-menu" onClick={() => setHostedOpen((open) => !open)}><span>HOSTED ENVIRONMENTS &amp; ARTIFACTS</span><SidebarChevron open={hostedOpen} /></button>
        {hostedOpen ? <nav id="hosted-menu" className="sidebar-menu" aria-label="Hosted environment and artifact labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab26' ? ' selected' : '')} aria-current={activeLab === 'lab26' ? 'page' : undefined} onClick={() => setActiveLab('lab26')}><span className="nav-number">26</span><span className="sidebar-item-copy"><strong>Choose an environment</strong><small>none · openai_hosted · Evidence</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab27' ? ' selected' : '')} aria-current={activeLab === 'lab27' ? 'page' : undefined} onClick={() => setActiveLab('lab27')}><span className="nav-number">27</span><span className="sidebar-item-copy"><strong>Provide input files</strong><small>environment.files · Source · Control</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab28' ? ' selected' : '')} aria-current={activeLab === 'lab28' ? 'page' : undefined} onClick={() => setActiveLab('lab28')}><span className="nav-number">28</span><span className="sidebar-item-copy"><strong>Configure packages &amp; network</strong><small>Pin · Allowlist · Policy</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab29' ? ' selected' : '')} aria-current={activeLab === 'lab29' ? 'page' : undefined} onClick={() => setActiveLab('lab29')}><span className="nav-number">29</span><span className="sidebar-item-copy"><strong>Create &amp; download artifacts</strong><small>Outputs · Identify · Download</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab30' ? ' selected' : '')} aria-current={activeLab === 'lab30' ? 'page' : undefined} onClick={() => setActiveLab('lab30')}><span className="nav-number">30</span><span className="sidebar-item-copy"><strong>Clean up sandbox resources</strong><small>Retain · Delete · Verify</small></span></button>
        </nav> : null}
        <button type="button" className="sidebar-section-toggle sidebar-stage-toggle" aria-expanded={harnessOpen} aria-controls="harness-menu" onClick={() => setHarnessOpen((open) => !open)}><span>HARNESS ARCHITECTURE &amp; SECURITY</span><SidebarChevron open={harnessOpen} /></button>
        {harnessOpen ? <nav id="harness-menu" className="sidebar-menu" aria-label="Harness architecture and security labs">
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab31' ? ' selected' : '')} aria-current={activeLab === 'lab31' ? 'page' : undefined} onClick={() => setActiveLab('lab31')}><span className="nav-number">31</span><span className="sidebar-item-copy"><strong>Understand the agent harness</strong><small>Model / Loop / Compute / Evidence</small></span></button>
          <button type="button" className={'sidebar-lab' + (activeLab === 'lab32' ? ' selected' : '')} aria-current={activeLab === 'lab32' ? 'page' : undefined} onClick={() => setActiveLab('lab32')}><span className="nav-number">32</span><span className="sidebar-item-copy"><strong>Connect a self-hosted environment</strong><small>Executor / Connection / Files</small></span></button>
        </nav> : null}
        <div className="sidebar-bottom"><span className="mini-orb">◆</span><div><strong>32 implemented labs</strong><small>From first run to advanced agents</small></div></div>
      </aside>

      <main className={'main' + (activeLab === 'home' ? ' main-home' : '')}>
        <button type="button" className="mobile-home-link" aria-current={activeLab === 'home' ? 'page' : undefined} onClick={() => setActiveLab('home')}>Home</button>
        {activeLab === 'home' ? <section className="home-page" aria-labelledby="home-title">
          <div className="home-art">
            <button type="button" className="home-enter" onClick={() => setActiveLab('lab1')} aria-label="Open the labs"><img className="home-logo" src={openaiIcon} alt="" /></button>
            <h1 id="home-title">OpenAI Agents API</h1>
            <div className="home-author">
              <div className="home-portrait"><img src={authorPortrait} alt="Luis Coco Enríquez" /></div>
              <div className="home-author-label"><span className="home-author-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="15" r="8"/><path d="M9 40v-4c0-8 6-13 15-13s15 5 15 13v4z"/></svg></span><span>Author: Luis Coco Enríquez</span></div>
            </div>
          </div>
        </section> : null}
        <header className="topbar"><span>COURSE / {['lab31', 'lab32'].includes(activeLab) ? 'HARNESS ARCHITECTURE & SECURITY' : ['lab26', 'lab27', 'lab28', 'lab29', 'lab30'].includes(activeLab) ? 'HOSTED ENVIRONMENTS & ARTIFACTS' : ['lab21', 'lab22', 'lab23', 'lab24', 'lab25'].includes(activeLab) ? 'SEARCH, MCP & PLUGINS' : ['lab16', 'lab17', 'lab18', 'lab19', 'lab20'].includes(activeLab) ? 'FUNCTION TOOLS & HUMAN CONTROL' : ['lab11', 'lab12', 'lab13', 'lab14', 'lab15'].includes(activeLab) ? 'STREAMING & REACT' : ['lab6', 'lab7', 'lab8', 'lab9', 'lab10'].includes(activeLab) ? 'TYPESCRIPT & CONFIGURATION' : 'FOUNDATIONS'} / <b>LAB {activeLab.slice(3).padStart(2, '0')}</b></span><span className="top-right"><span className="status-dot" /> INTERACTIVE LAB</span></header>
        <nav className="mobile-lab-nav" aria-label="Choose a lab">{labIds.map(id => <button type="button" key={id} aria-current={activeLab === id ? 'page' : undefined} onClick={() => setActiveLab(id)}>Lab {id.slice(3).padStart(2, '0')}</button>)}</nav>
        <div className="content" style={{ display: activeLab === 'lab1' ? undefined : 'none' }}><Lab1 active={activeLab === 'lab1'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab2' ? undefined : 'none' }}><Lab2 active={activeLab === 'lab2'} feature={lab2Feature} onFeatureChange={setLab2Feature} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab3' ? undefined : 'none' }}><Lab3 active={activeLab === 'lab3'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab4' ? undefined : 'none' }}><Lab4 active={activeLab === 'lab4'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab5' ? undefined : 'none' }}><Lab5 active={activeLab === 'lab5'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab6' ? undefined : 'none' }}><Lab6 active={activeLab === 'lab6'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab7' ? undefined : 'none' }}><Lab7 active={activeLab === 'lab7'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab8' ? undefined : 'none' }}><Lab8 active={activeLab === 'lab8'} health={health} onOpenLab7={() => setActiveLab('lab7')} /></div>
        <div className="content" style={{ display: activeLab === 'lab9' ? undefined : 'none' }}><Lab9 active={activeLab === 'lab9'} health={health} onOpenLab7={() => setActiveLab('lab7')} /></div>
        <div className="content" style={{ display: activeLab === 'lab10' ? undefined : 'none' }}><Lab10 active={activeLab === 'lab10'} health={health} onOpenLab7={() => setActiveLab('lab7')} /></div>
        <div className="content" style={{ display: activeLab === 'lab11' ? undefined : 'none' }}><Lab11 active={activeLab === 'lab11'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab12' ? undefined : 'none' }}><Lab12 active={activeLab === 'lab12'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab13' ? undefined : 'none' }}><Lab13 active={activeLab === 'lab13'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab14' ? undefined : 'none' }}><Lab14 active={activeLab === 'lab14'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab15' ? undefined : 'none' }}><Lab15 active={activeLab === 'lab15'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab16' ? undefined : 'none' }}><Lab16 active={activeLab === 'lab16'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab17' ? undefined : 'none' }}><Lab17 active={activeLab === 'lab17'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab18' ? undefined : 'none' }}><Lab18 active={activeLab === 'lab18'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab19' ? undefined : 'none' }}><Lab19 active={activeLab === 'lab19'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab20' ? undefined : 'none' }}><Lab20 active={activeLab === 'lab20'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab21' ? undefined : 'none' }}><Lab21 active={activeLab === 'lab21'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab22' ? undefined : 'none' }}><Lab22 active={activeLab === 'lab22'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab23' ? undefined : 'none' }}><Lab23 active={activeLab === 'lab23'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab24' ? undefined : 'none' }}><Lab24 active={activeLab === 'lab24'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab25' ? undefined : 'none' }}><Lab25 active={activeLab === 'lab25'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab26' ? undefined : 'none' }}><Lab26 active={activeLab === 'lab26'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab27' ? undefined : 'none' }}><Lab27 active={activeLab === 'lab27'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab28' ? undefined : 'none' }}><Lab28 active={activeLab === 'lab28'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab29' ? undefined : 'none' }}><Lab29 active={activeLab === 'lab29'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab30' ? undefined : 'none' }}><Lab30 active={activeLab === 'lab30'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab31' ? undefined : 'none' }}><Lab31 active={activeLab === 'lab31'} health={health} /></div>
        <div className="content" style={{ display: activeLab === 'lab32' ? undefined : 'none' }}><Lab32 active={activeLab === 'lab32'} /></div>
      </main>
    </div>
  );
}
