/* ==================== PUBLIC ==================== */

const crypto = require("crypto");

/* The client and the server argree on the N, g, k and hash function */

/**
 * Computes a SHA-256 hash of the given arguments, and returns the result as a BigInt value.
 *
 * @param {...string} args - The input arguments to be hashed.
 * @returns {bigint} The SHA-256 hash value as a BigInt.
 */
const hash = (...args) => {
    const text = args.join(":");
    return BigInt(
        `0x${crypto
            .createHash("sha256")
            .update(text)
            .digest("hex")
        }`
    );
};

/**
 * Generates a cryptographically secure salt of the specified length and returns it as a BigInt.
 *
 * @function
 * @param {number} length - The length of the salt in bytes.
 * @returns {bigint} - The salt value as a BigInt.
 *
 * @example
 * // Generate a salt with 16 bytes of randomness.
 * const salt = generateSalt(16);
 * console.log(salt); // 133031290157045872024582203984
 */
const generateSalt = (length) => {
    const saltBytes = new Uint8Array(length);
    crypto.getRandomValues(saltBytes);
    const saltString = Array.from(saltBytes)
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join("");
    return BigInt(`0x${saltString}`);
};

/**
 * Computes the value of a BigInt raised to a power modulo a modulus.
 * More to see https://en.wikipedia.org/wiki/Modular_exponentiation
 *
 * @param {BigInt} num - The base value.
 * @param {BigInt} power - The exponent.
 * @param {BigInt} modulus - The modulus value.
 * @returns {BigInt} The value of `num` raised to the `power` modulo `modulus`.
 */
const bigIntExponentiation = (num, power, modulus) => {
    let result = 1n;
    num = num % modulus;
    while (power > 0n) {
        if (power % 2n === 1n) {
            result = (result * num) % modulus;
        }
        power = power >> 1n;
        num = (num * num) % modulus;
    }
    return result;
};

/* Generated by "openssl dhparam -text 2048" */
const dhparam = `\
00:aa:d9:ea:e2:b5:3d:86:fb:88:51:99:ea:cf:14:\
cd:65:f9:86:25:1e:e9:f9:42:e5:97:14:6c:49:dc:\
4c:38:e8:4c:44:24:df:f9:0f:c2:8e:cd:66:11:37:\
95:df:fe:53:a6:c5:50:1f:61:8b:fd:e8:9c:17:4d:\
84:6b:08:6d:29:76:39:79:fc:91:ea:c2:af:ad:b5:\
11:ab:de:3d:7b:d6:7f:31:8c:dc:29:2e:9a:39:6a:\
6c:cf:5f:6c:24:0c:10:21:92:8b:85:5b:67:f0:ae:\
62:93:2d:eb:75:a6:bc:f7:0c:71:8c:cd:96:0d:53:\
58:e3:7b:76:71:a9:8b:2a:93`;
/* A large safe prime */
const N = BigInt(`0x${dhparam.trim().split(":").join("")}`);
/* A generator modulo N */
const g = 2n;
/* Multiplier parameter */
const k = hash(N, g);

console.log("==================== PUBLIC ====================");
console.log("N:", N);
console.log("g:", g);
console.log("k:", k);
console.log("================================================");

/* ==================== PARTICULAR ==================== */

const express = require("express");
const websocket = require("ws");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const port = 9090;
const db = new sqlite3.Database("database/srp");

app.use(express.static("."));
app.use(express.json());

const statusOk = 200;
const statusUnauthorized = 401;
const statusBadRequest = 400;
const statusInternalServerError = 500;

const server = app.listen(port, () => {
    console.log(`Server is running on the port ${port}`);
});

app.post("/register", (req, res) => {
    const { I, s, v } = req.body;
    if (!I || !s || !v) {
        res.status(statusBadRequest).send("Failed to get I, s and v");
        return;
    }

    console.log("=================== REGISTER ===================");
    console.log(`Get register body:\nI(username): ${I}\ns(random salt): ${s}\nv(password verifier): ${v}`);
    console.log("================================================");

    db.run("insert into users(I, s, v) values (?, ?, ?)", [I, s, v], function (error) {
        if (error) {
            console.log("register fail:", error);
            res.status(statusInternalServerError).send(error.message);
            return;
        }
        res.status(statusOk).send("register success");
    });
});

const wsServer = new websocket.Server({ server, path: "/login" });
wsServer.on("connection", (ws) => {
    console.log("==================== LOGIN ====================");

    /* just a copy of username I */
    let _I = "";
    /* just a copy of the public ephemeral values A and B */
    let _A = 0n, _B = 0n;
    /* just a copy of the secret ephemeral values */
    let _b = 0n;
    /* just a copy of the user salt s */
    let _s = "";
    /* just a copy of the password verifier v */
    let _v = 0n;
    /* just a copy of the random scrambling parameter u */
    let _u = 0n;
    /* just a copy of the hash of session key K */
    let _K = 0n;
    /* serial indicates which step is doing now */
    ws.send(JSON.stringify({ serial: 1 }));

    ws.on("message", async (message) => {
        let { serial, data } = JSON.parse(new TextDecoder().decode(message));
        switch (serial) {
            case 2:
                /* Step 2: The server sends user's salt s and public ephemeral value B to client */
                const { I, A } = data; _I = I; _A = BigInt(`0x${A}`);
                console.log(`I(username): ${_I}\nA(public ephemeral values): ${_A}`);
                if (_A % N === 0n) {
                    /* The host will abort if it detects that A == 0 (mod N) */
                    ws.close();
                    return;
                }
                db.all("select s, v from users where I = ?", [I], (error, rows) => {
                    if (error) {
                        console.log(`failed to find ${I} in users: ${error}`);
                        ws.send(JSON.stringify({
                            serial: 0x99,
                            data: { error }
                        }));
                        ws.close();
                        return;
                    }
                    const { s, v } = rows[0]; _s = BigInt(`0x${s}`); _v = BigInt(`0x${v}`);
                    console.log(`s(user salt): ${_s}\nv(password verifier): ${_v}`);
                    /* secret ephemeral values b */
                    const b = generateSalt(32) % N; _b = b;
                    /* public ephemeral values B */
                    const B = (k * _v + bigIntExponentiation(g, b, N)) % N; _B = B;
                    ws.send(JSON.stringify({
                        serial: serial + 1,
                        data: { s, B: B.toString(16) }
                    }));
                    console.log(`b(secret ephemeral values): ${_b}\nB(public ephemeral values): ${_B}`);
                });
                break;
            case 3:
                /* Step 3: The client and server calculate the random scrambling parameter */
                /* random scrambling parameter */
                const u = hash(_A, _B); _u = u;
                console.log(`u(random scrambling parameter): ${_u}`);
                ws.send(JSON.stringify({ serial: serial + 1 }));
                break;
            case 5:
                /* Step 5: The server computes session key */
                /* session key */
                const S = bigIntExponentiation(_A * bigIntExponentiation(_v, _u, N), _b, N);
                /* hash of session key */
                const K = hash(S); _K = K;
                console.log(`S(session key): ${S}\nK(hash of session key): ${_K}`);
                ws.send(JSON.stringify({ serial: serial + 1 }));
                break;
            case 7:
                /* Step 7: The server sends proof of session key to client */
                const { C_M } = data;
                /* server M */
                const S_M = hash(
                    hash(N) ^ hash(g),
                    hash(_I), _s, _A, _B, _K
                );
                console.log(`C_M(client M): ${BigInt(`0x${C_M}`)}\nS_M(server M): ${S_M}`);
                /* Compare M between the client and server */
                ws.close(1000, JSON.stringify({
                    status: S_M === BigInt(`0x${C_M}`)
                        ? statusOk
                        : statusUnauthorized
                }));
                break;
            default:
                console.log("unexpected error:", data.error);
        }
    });
    ws.on("close", () => {
        console.log("===============================================");
    });
    ws.on("error", (error) => {
        console.log("websocket error:", error.message);
    });
});

app.get("/", (req, res) => {
    res.sendFile("./index.html", {
        root: __dirname
    });
});