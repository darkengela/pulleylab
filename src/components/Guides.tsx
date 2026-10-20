import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
const PAGES = {
  profiles: {
    title: 'HTD 3M, 5M, and 8M profiles — HTD pulley generator',
    description:
      'What HTD 3M, 5M, and 8M pitch means on an HTD timing pulley, and which profiles the HTD pulley generator builds.',
    canonical: 'https://pulleylab.vercel.app/htd-profiles',
    heading: 'HTD 3M, 5M, and 8M pulley profiles',
  },
  shaft: {
    title: 'D-shaft bore — HTD pulley generator',
    description:
      'Circular bore or a D-shaft on an HTD timing pulley. In the HTD pulley generator, diameter is the full round size and flat is the distance from the flat face to the opposite point.',
    canonical: 'https://pulleylab.vercel.app/d-shaft',
    heading: 'Bore and D-shaft',
  },
  download: {
    title: 'STEP and STL download — HTD pulley generator',
    description:
      'Download a STEP file for Fusion or an STL for printing from the HTD pulley generator. The HTD timing pulley is built in the browser.',
    canonical: 'https://pulleylab.vercel.app/download',
    heading: 'STEP and STL download',
  },
} as const;
function usePage(title: string, description: string, canonical: string) {
  useEffect(() => {
    const titleWas = document.title;
    const meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const descWas = meta?.content ?? '';
    const link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    const canonWas = link?.href ?? '';
    document.title = title;
    if (meta) meta.content = description;
    if (link) link.href = canonical;
    return () => {
      document.title = titleWas;
      if (meta) meta.content = descWas;
      if (link) link.href = canonWas;
    };
  }, [title, description, canonical]);
}
function Frame({
  heading,
  children,
  links,
}: {
  heading: string;
  children: ReactNode;
  links: { to: string; label: string }[];
}) {
  return (
    <article className="guide">
      <Link className="guide-brand" to="/">
        pulley<span>lab</span>
      </Link>
      <h1>{heading}</h1>
      {children}
      <Link className="guide-back" to="/">
        Open the HTD pulley generator
      </Link>
      <nav className="guide-footer" aria-label="Guides">
        {links.map((link) => (
          <Link key={link.to} to={link.to}>
            {link.label}
          </Link>
        ))}
      </nav>
    </article>
  );
}
export function ProfilesGuide() {
  const page = PAGES.profiles;
  usePage(page.title, page.description, page.canonical);
  return (
    <Frame
      heading={page.heading}
      links={[
        { to: '/d-shaft', label: 'D-shaft bore' },
        { to: '/download', label: 'STEP and STL' },
      ]}
    >
      <p>
        PulleyLab is an HTD pulley generator for three HTD timing pulley pitches. Pitch is the
        distance from one tooth to the next, measured along the pitch line.
      </p>
      <ul>
        <li>HTD 3M has a 3 mm pitch.</li>
        <li>HTD 5M has a 5 mm pitch.</li>
        <li>HTD 8M has an 8 mm pitch.</li>
      </ul>
      <h2>What the generator uses</h2>
      <p>
        Match the pitch printed on the belt. Tooth count can be any whole number from 12 to 240.
        Pitch diameter is tooth count times pitch, divided by π. The outside diameter is smaller
        than that pitch diameter by the profile offset used for that pitch.
      </p>
      <p>
        The tooth shape is a nominal HTD circular-arc profile. GT belts are a different profile,
        and HTD 14M and 20M are not included. Belt fit on a printed or machined part has not been
        verified here, so check a short test piece before the final part.
      </p>
    </Frame>
  );
}
export function ShaftGuide() {
  const page = PAGES.shaft;
  usePage(page.title, page.description, page.canonical);
  return (
    <Frame
      heading={page.heading}
      links={[
        { to: '/htd-profiles', label: 'HTD profiles' },
        { to: '/download', label: 'STEP and STL' },
      ]}
    >
      <p>
        The HTD pulley generator can cut either a circular bore or a D-shaft bore through an HTD
        timing pulley. Leave D-shaft off to keep a round hole. Set that bore to 0 mm for a solid
        center.
      </p>
      <h2>How the D is measured</h2>
      <p>A D-shaft bore is a circle with one flat. Both sizes are in millimeters.</p>
      <ul>
        <li>Diameter is the full round diameter of the D.</li>
        <li>
          Flat is the across-flat distance, from the flat face to the opposite point on the circle.
          It has to be greater than 0 and less than the diameter.
        </li>
      </ul>
      <p>
        An 8 mm D-shaft with a 7 mm flat is an 8 mm circle with the flat 7 mm from the far side of
        that circle. In the model the bore axis is Z and the flat faces +X. Hubs and flanges still
        generate around that hole.
      </p>
      <p>
        If you use the drive ratio planner, the drive pulley keeps the D-shaft when it is turned
        on. The driven pulley uses the circular driven shaft bore.
      </p>
    </Frame>
  );
}
export function DownloadGuide() {
  const page = PAGES.download;
  usePage(page.title, page.description, page.canonical);
  return (
    <Frame
      heading={page.heading}
      links={[
        { to: '/htd-profiles', label: 'HTD profiles' },
        { to: '/d-shaft', label: 'D-shaft bore' },
      ]}
    >
      <p>
        After you generate an HTD timing pulley, the HTD pulley generator can download a STEP file
        or an STL file. The solid is built in the browser. Dimensions are not uploaded.
      </p>
      <h2>STEP for CAD</h2>
      <p>
        STEP is a manifold solid in millimeters. In Fusion, choose File → Open → Open from my
        computer. The file imports as a solid body, not as an editable feature history. Preview
        colors in PulleyLab do not change the exported geometry.
      </p>
      <h2>STL for printing</h2>
      <p>
        STL is a triangle mesh of the same solid, for a slicer. Print a short test piece before a
        final part. The HTD tooth form is a nominal circular-arc profile, and physical belt fit has
        not been verified here.
      </p>
    </Frame>
  );
}
export function NotFound() {
  usePage(
    'Page not found — PulleyLab',
    'This address is not part of the HTD pulley generator.',
    'https://pulleylab.vercel.app/',
  );
  return (
    <article className="guide">
      <h1>Page not found</h1>
      <p>This address is not part of the HTD pulley generator.</p>
      <Link className="guide-back" to="/">
        Open the HTD pulley generator
      </Link>
    </article>
  );
}
