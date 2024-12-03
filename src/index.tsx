import { Hono } from "hono";
import { renderer } from "./renderer";

interface SpeedTestServer {
  url: string;
  lat: string;
  lon: string;
  distance: number;
  name: string;
  country: string;
  cc: string;
  sponsor: string;
  id: string;
  preferred: number;
  https_functional: number;
  host: string;
}

// IPs from major countries in each continent
const CONTINENTAL_IPS = {
  northAmerica: [
    {
      country: "United States",
      ips: [
        "104.16.132.229", // Cloudflare
        "8.8.8.8", // Google
        "205.251.242.103", // AWS
        "157.240.2.35", // Facebook
        "104.244.42.193", // Twitter
      ],
    },
    {
      country: "Canada",
      ips: [
        "99.79.32.120", // AWS Canada
        "35.182.93.184", // AWS Canada
        "52.60.50.0", // Azure Canada
        "104.215.116.88", // Azure Canada
      ],
    },
    {
      country: "Mexico",
      ips: [
        "189.203.197.143", // Telmex
        "201.175.47.68", // Telcel
        "187.190.255.160", // Axtel
        "200.56.193.140", // Alestra
      ],
    },
  ],
  europe: [
    {
      country: "Germany",
      ips: [
        "87.121.61.139", // Deutsche Telekom
        "3.120.181.107", // AWS Frankfurt
        "52.29.63.206", // AWS Frankfurt
        "35.157.127.248", // AWS Frankfurt
        "18.184.99.128", // AWS Frankfurt
      ],
    },
    {
      country: "United Kingdom",
      ips: [
        "178.62.127.241", // DigitalOcean London
        "35.176.92.63", // AWS London
        "52.56.34.0", // AWS London
        "51.141.47.105", // Azure UK
      ],
    },
    {
      country: "France",
      ips: [
        "51.159.30.240", // OVH
        "163.172.220.253", // Scaleway
        "35.180.0.1", // AWS Paris
        "35.181.3.245", // AWS Paris
      ],
    },
  ],
  asia: [
    {
      country: "Japan",
      ips: [
        "103.152.34.12", // NTT
        "54.178.26.110", // AWS Tokyo
        "52.192.64.163", // AWS Tokyo
        "40.115.186.96", // Azure Japan
        "104.215.140.80", // Azure Japan
      ],
    },
    {
      country: "Singapore",
      ips: [
        "174.138.27.185", // DigitalOcean
        "52.74.223.119", // AWS Singapore
        "52.221.221.153", // AWS Singapore
        "104.215.189.96", // Azure Singapore
      ],
    },
    {
      country: "South Korea",
      ips: [
        "119.205.235.214", // SK Broadband
        "52.78.63.252", // AWS Seoul
        "13.124.63.251", // AWS Seoul
        "52.231.32.118", // Azure Korea
      ],
    },
  ],
  oceania: [
    {
      country: "Australia",
      ips: [
        "1.1.1.1", // Cloudflare
        "54.253.0.200", // AWS Sydney
        "52.62.63.255", // AWS Sydney
        "13.70.159.8", // Azure Australia
        "168.1.168.1", // Oracle Cloud
      ],
    },
    {
      country: "New Zealand",
      ips: [
        "103.247.196.86", // 2degrees
        "49.50.252.21", // Spark
        "203.109.152.251", // Vodafone
        "103.231.168.1", // Vocus
      ],
    },
  ],
  southAmerica: [
    {
      country: "Brazil",
      ips: [
        "200.229.211.1", // Embratel
        "54.232.0.241", // AWS São Paulo
        "52.67.255.254", // AWS São Paulo
        "191.232.38.129", // Azure Brazil
        "152.67.40.0", // Oracle Cloud
      ],
    },
    {
      country: "Argentina",
      ips: [
        "181.30.128.34", // Telecom Argentina
        "200.5.119.42", // Telefonica
        "190.210.25.157", // Claro
        "200.123.180.122", // Level 3
      ],
    },
    {
      country: "Chile",
      ips: [
        "200.12.186.50", // GTD
        "200.75.0.1", // Movistar
        "200.29.248.1", // VTR
        "200.54.168.1", // Claro
      ],
    },
  ],
};

const app = new Hono();

app.use(renderer);

app.get("/", (c) => {
  return c.render(<h1>Hello! This is a speedtest API</h1>);
});

async function fetchSpeedTestServers(ip: string): Promise<SpeedTestServer[]> {
  const myHeaders = new Headers();
  myHeaders.append("X-Forwarded-For", ip);

  const requestOptions = {
    method: "GET",
    headers: myHeaders,
    redirect: "follow",
  };

  const response = await fetch(
    "https://librespeed.speedtestcustom.com/api/js/servers?engine=js&https_functional=true&limit=10000",
    requestOptions
  );
  return (await response.json()) as SpeedTestServer[];
}

app.get("/speedtest/:ip", async (c) => {
  const ip = c.req.param("ip");

  try {
    const data = await fetchSpeedTestServers(ip);
    return c.json({
      total: data.length,
      servers: data,
    });
  } catch (error) {
    return c.json({ error: "Failed to fetch speedtest servers" }, 500);
  }
});

app.get("/speedtest", async (c) => {
  try {
    // Get all IPs from all continents and countries
    const allRequests = Object.values(CONTINENTAL_IPS).flatMap((continent) =>
      continent.flatMap((country) =>
        country.ips.map((ip) => ({
          ip,
          country: country.country,
        }))
      )
    );

    // Fetch data from all IPs in parallel
    const results = await Promise.all(
      allRequests.map(async ({ ip, country }) => {
        try {
          const servers = await fetchSpeedTestServers(ip);
          return { country, ip, servers };
        } catch (error) {
          console.error(`Failed to fetch from ${country} (${ip}): ${error}`);
          return { country, ip, servers: [] };
        }
      })
    );

    // Group results by country
    const countryResults = results.reduce((acc, { country, ip, servers }) => {
      if (!acc[country]) {
        acc[country] = { servers: [], ips: [] };
      }
      acc[country].servers.push(...servers);
      acc[country].ips.push(ip);
      return acc;
    }, {} as Record<string, { servers: SpeedTestServer[]; ips: string[] }>);

    // Merge all results and remove duplicates based on server ID
    const mergedResults = Object.values(countryResults).flatMap(
      (r) => r.servers
    );
    const uniqueResults = Array.from(
      new Map(mergedResults.map((server) => [server.id, server])).values()
    );

    // Sort by distance
    uniqueResults.sort((a, b) => a.distance - b.distance);

    return c.json({
      total: uniqueResults.length,
      // countries: Object.entries(countryResults).map(([country, data]) => ({
      //   country,
      //   ipsUsed: data.ips,
      //   serverCount: data.servers.length,
      // })),
      servers: uniqueResults,
    });
  } catch (error) {
    return c.json({ error: "Failed to fetch speedtest servers" }, 500);
  }
});

export default app;
