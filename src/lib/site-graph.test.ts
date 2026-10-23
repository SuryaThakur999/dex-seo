import { describe, it, expect } from 'vitest';
import { computeSiteGraph } from './site-graph';

const HOME = 'https://example.com/';

describe('computeSiteGraph', () => {
  it('returns an empty graph when there are no links', () => {
    expect(computeSiteGraph([], HOME)).toEqual({ nodes: [], edges: [] });
  });

  it('always includes the homepage even when it has no edges of its own', () => {
    const links = [{ fromUrl: 'https://example.com/a', toUrl: 'https://example.com/b' }];
    const graph = computeSiteGraph(links, HOME);
    expect(graph.nodes.some((n) => n.url === HOME)).toBe(true);
  });

  it('ranks non-homepage nodes by real degree and caps at maxNodes', () => {
    const links = [
      { fromUrl: HOME, toUrl: 'https://example.com/popular' },
      { fromUrl: 'https://example.com/other', toUrl: 'https://example.com/popular' },
      { fromUrl: HOME, toUrl: 'https://example.com/rare' },
    ];
    const graph = computeSiteGraph(links, HOME, 2);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.url)).toContain(HOME);
    expect(graph.nodes.map((n) => n.url)).toContain('https://example.com/popular');
    expect(graph.nodes.map((n) => n.url)).not.toContain('https://example.com/rare');
  });

  it('drops an edge if either endpoint was cut for not making the node cap', () => {
    const links = [
      { fromUrl: HOME, toUrl: 'https://example.com/a' },
      { fromUrl: 'https://example.com/a', toUrl: 'https://example.com/orphan' },
    ];
    const graph = computeSiteGraph(links, HOME, 2);
    expect(graph.edges).not.toContainEqual({ from: 'https://example.com/a', to: 'https://example.com/orphan' });
  });

  it('deduplicates identical edges and drops self-links', () => {
    const links = [
      { fromUrl: HOME, toUrl: 'https://example.com/a' },
      { fromUrl: HOME, toUrl: 'https://example.com/a' },
      { fromUrl: 'https://example.com/a', toUrl: 'https://example.com/a' },
    ];
    const graph = computeSiteGraph(links, HOME);
    expect(graph.edges).toEqual([{ from: HOME, to: 'https://example.com/a' }]);
  });

  it('treats a trailing-slash and non-trailing-slash URL as the same node', () => {
    const links = [
      { fromUrl: 'https://example.com', toUrl: 'https://example.com/a' },
      { fromUrl: 'https://example.com/b', toUrl: 'https://example.com/' },
    ];
    const graph = computeSiteGraph(links, HOME);
    const homeNodes = graph.nodes.filter((n) => n.label === 'Home');
    expect(homeNodes).toHaveLength(1);
    expect(homeNodes[0].linkCount).toBe(2);
  });

  it('labels the homepage as Home and other pages by their pathname', () => {
    const links = [{ fromUrl: HOME, toUrl: 'https://example.com/about' }];
    const graph = computeSiteGraph(links, HOME);
    const home = graph.nodes.find((n) => n.url === HOME)!;
    const about = graph.nodes.find((n) => n.url === 'https://example.com/about')!;
    expect(home.label).toBe('Home');
    expect(about.label).toBe('/about');
  });
});
