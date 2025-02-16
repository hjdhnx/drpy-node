import path from 'path';
import {existsSync} from 'fs';
import {base64Decode} from '../libs_drpy/crypto-util.js';
import * as drpy from '../libs/drpyS.js';
import {ENV} from "../utils/env.js";
import {validatePwd} from "../utils/api_validate.js";

export default (fastify, options, done) => {
    // 动态加载模块并根据 query 执行不同逻辑
    fastify.route({
        method: ['GET', 'POST'], // 同时支持 GET 和 POST
        url: '/api/:module',
        preHandler: validatePwd,
        schema: {
            consumes: ['application/json', 'application/x-www-form-urlencoded'], // 声明支持的内容类型
        },
        handler: async (request, reply) => {
            const moduleName = request.params.module;
            const modulePath = path.join(options.jsDir, `${moduleName}.js`);
            if (!existsSync(modulePath)) {
                reply.status(404).send({error: `Module ${moduleName} not found`});
                return;
            }
            const method = request.method.toUpperCase();
            // 根据请求方法选择参数来源
            const query = method === 'GET' ? request.query : request.body;
            const moduleExt = query.extend || '';
            // console.log('moduleExt:', typeof moduleExt, moduleExt);
            const protocol = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');
            const hostname = request.hostname;
            // const proxyUrl = `${protocol}://${hostname}${request.url}`.split('?')[0].replace('/api/', '/proxy/') + '/?do=js';
            // const proxyUrl = `${protocol}://${hostname}/proxy/${moduleName}/?do=js`;
            // console.log('proxyUrl:', proxyUrl);

            const publicUrl = `${protocol}://${hostname}/public/`;
            const jsonUrl = `${protocol}://${hostname}/json/`;
            const httpUrl = `${protocol}://${hostname}/http`;
            const mediaProxyUrl = `${protocol}://${hostname}/mediaProxy`;
            const hostUrl = `${hostname.split(':')[0]}`;
            const fServer = fastify.server;

            // console.log(`proxyUrl:${proxyUrl}`);
            function getEnv(moduleName) {
                const proxyUrl = `${protocol}://${hostname}/proxy/${moduleName}/?do=js`;
                const getProxyUrl = function () {
                    return proxyUrl
                };
                return {
                    proxyUrl,
                    publicUrl,
                    jsonUrl,
                    httpUrl,
                    mediaProxyUrl,
                    hostUrl,
                    hostname,
                    fServer,
                    getProxyUrl,
                    ext: moduleExt
                }
            }

            const env = getEnv(moduleName);
            env.getRule = async function (_moduleName) {
                const _modulePath = path.join(options.jsDir, `${_moduleName}.js`);
                if (!existsSync(_modulePath)) {
                    return null;
                }
                const _env = getEnv(_moduleName);
                const RULE = await drpy.getRule(_modulePath, _env);
                RULE.callRuleFn = async function (_method, _args) {
                    let invokeMethod = null;
                    switch (_method) {
                        case 'class_parse':
                            invokeMethod = 'home';
                            break;
                        case '推荐':
                            invokeMethod = 'homeVod';
                            break;
                        case '一级':
                            invokeMethod = 'cate';
                            break;
                        case '二级':
                            invokeMethod = 'detail';
                            break;
                        case '搜索':
                            invokeMethod = 'search';
                            break;
                        case 'lazy':
                            invokeMethod = 'play';
                            break;
                        case 'proxy_rule':
                            invokeMethod = 'proxy';
                            break;
                        case 'action':
                            invokeMethod = 'action';
                            break;
                    }
                    if (!invokeMethod) {
                        if (typeof RULE[_method] !== 'function') {
                            return null
                        } else {
                            return await RULE[_method]
                        }
                    }
                    return await drpy[invokeMethod](_modulePath, _env, ..._args)
                };
                return RULE
            };
            const pg = Number(query.pg) || 1;
            try {
                // 根据 query 参数决定执行逻辑
                if ('play' in query) {
                    // 处理播放逻辑
                    // console.log('play query:', query);
                    const result = await drpy.play(modulePath, env, query.flag, query.play);
                    return reply.send(result);
                }

                if ('ac' in query && 't' in query) {
                    let ext = query.ext;
                    // console.log('ext:', ext);
                    let extend = {};
                    if (ext) {
                        try {
                            extend = JSON.parse(base64Decode(ext))
                        } catch (e) {
                            fastify.log.error(`筛选参数错误:${e.message}`);
                        }
                    }
                    // 分类逻辑
                    const result = await drpy.cate(modulePath, env, query.t, pg, 1, extend);
                    return reply.send(result);
                }

                if ('ac' in query && 'ids' in query) {
                    if (method === 'POST') {
                        fastify.log.info(`[${moduleName}] 二级已接收post数据: ${query.ids}`);
                    }
                    // 详情逻辑
                    const result = await drpy.detail(modulePath, env, query.ids.split(','));
                    return reply.send(result);
                }

                if ('ac' in query && 'action' in query) {
                    // 处理动作逻辑
                    const result = await drpy.action(modulePath, env, query.action, query.value);
                    return reply.send(result);
                }


                if ('wd' in query) {
                    // 搜索逻辑
                    const quick = 'quick' in query ? query.quick : 0;
                    const result = await drpy.search(modulePath, env, query.wd, quick, pg);
                    return reply.send(result);
                }

                if ('refresh' in query) {
                    // 强制刷新初始化逻辑
                    const refreshedObject = await drpy.init(modulePath, env, true);
                    return reply.send(refreshedObject);
                }
                if (!('filter' in query)) {
                    query.filter = 1
                }
                // 默认逻辑，返回 home + homeVod 接口
                const filter = 'filter' in query ? query.filter : 1;
                const resultHome = await drpy.home(modulePath, env, filter);
                const resultHomeVod = await drpy.homeVod(modulePath, env);
                let result = {
                    ...resultHome,
                    // list: resultHomeVod,
                };
                if (Array.isArray(resultHomeVod) && resultHomeVod.length > 0) {
                    Object.assign(result, {list: resultHomeVod})
                }

                reply.send(result);

            } catch (error) {
                // console.log('Error processing request:', error);
                // reply.status(500).send({error: `Failed to process request for module ${moduleName}: ${error.message}`});

                fastify.log.error(`Error api module ${moduleName}:${error.message}`);
                reply.status(500).send({error: `Failed to process module ${moduleName}: ${error.message}`});
            }
        }
    });

    fastify.get('/proxy/:module/*', async (request, reply) => {
        const moduleName = request.params.module;
        const query = request.query; // 获取 query 参数
        const modulePath = path.join(options.jsDir, `${moduleName}.js`);
        if (!existsSync(modulePath)) {
            reply.status(404).send({error: `Module ${moduleName} not found`});
            return;
        }
        const proxyPath = request.params['*']; // 捕获整个路径
        fastify.log.info(`try proxy for ${moduleName} -> ${proxyPath}: ${JSON.stringify(query)}`);
        const rangeHeader = request.headers.range; // 获取客户端的 Range 请求头

        const moduleExt = query.extend || '';
        const protocol = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');
        const hostname = request.hostname;

        const publicUrl = `${protocol}://${hostname}/public/`;
        const jsonUrl = `${protocol}://${hostname}/json/`;
        const httpUrl = `${protocol}://${hostname}/http`;
        const mediaProxyUrl = `${protocol}://${hostname}/mediaProxy`;
        const hostUrl = `${hostname.split(':')[0]}`;
        const fServer = fastify.server;

        function getEnv(moduleName) {
            const proxyUrl = `${protocol}://${hostname}/proxy/${moduleName}/?do=js`;
            const getProxyUrl = function () {
                return proxyUrl
            };
            return {
                proxyUrl,
                proxyPath,
                publicUrl,
                jsonUrl,
                httpUrl,
                mediaProxyUrl,
                hostUrl,
                hostname,
                fServer,
                getProxyUrl,
                ext: moduleExt
            }
        }

        const env = getEnv(moduleName);
        try {
            const backRespList = await drpy.proxy(modulePath, env, query);
            const statusCode = backRespList[0];
            const mediaType = backRespList[1] || 'application/octet-stream';
            let content = backRespList[2] || '';
            const headers = backRespList.length > 3 ? backRespList[3] : null;
            const toBytes = backRespList.length > 4 ? backRespList[4] : null;
            // 如果需要转换为字节内容(尝试base64转bytes)
            if (toBytes === 1) {
                try {
                    if (content.includes('base64,')) {
                        content = unescape(content.split("base64,")[1]);
                    }
                    content = Buffer.from(content, 'base64');
                } catch (e) {
                    fastify.log.error(`Local Proxy toBytes error: ${e}`);
                }
            }
            // 流代理
            else if (toBytes === 2 && content.startsWith('http')) {
                const new_headers = {
                    ...(headers ? headers : {}),
                    ...(rangeHeader ? {Range: rangeHeader} : {}), // 添加 Range 请求头
                }
                // return proxyStreamMediaMulti(content, new_headers, request, reply); // 走  流式代理
                // 将查询参数构建为目标 URL
                const redirectUrl = `/mediaProxy?url=${encodeURIComponent(content)}&headers=${encodeURIComponent(JSON.stringify(new_headers))}&thread=${ENV.get('thread') || 1}`;
                // 执行重定向
                return reply.redirect(redirectUrl);
            }

            // 根据媒体类型来决定如何设置字符编码
            if (typeof content === 'string') {
                // 如果返回的是文本内容（例如 JSON 或字符串）
                if (mediaType && (mediaType.includes('text') || mediaType === 'application/json')) {
                    // 对于文本类型，设置 UTF-8 编码
                    reply
                        .code(statusCode)
                        .type(`${mediaType}; charset=utf-8`)  // 设置编码为 UTF-8
                        .headers(headers || {})  // 如果有headers, 则加上
                        .send(content);
                } else {
                    // 对于其他类型的文本（例如 XML），直接返回，不指定 UTF-8 编码
                    reply
                        .code(statusCode)
                        .type(mediaType)
                        .headers(headers || {})
                        .send(content);
                }
            } else {
                // 如果返回的是二进制内容（例如图片或其他文件）
                reply
                    .code(statusCode)
                    .type(mediaType)  // 使用合适的媒体类型，如 image/png
                    .headers(headers || {})
                    .send(content);
            }

        } catch (error) {
            fastify.log.error(`Error proxy module ${moduleName}:${error.message}`);
            reply.status(500).send({error: `Failed to proxy module ${moduleName}: ${error.message}`});
        }
    });


    fastify.get('/parse/:jx', async (request, reply) => {
        let t1 = (new Date()).getTime();
        const jxName = request.params.jx;
        const query = request.query; // 获取 query 参数
        const jxPath = path.join(options.jxDir, `${jxName}.js`);
        if (!existsSync(jxPath)) {
            return reply.status(404).send({error: `解析 ${jxName} not found`});
        }
        const moduleExt = query.extend || '';
        const protocol = request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http');
        const hostname = request.hostname;

        const publicUrl = `${protocol}://${hostname}/public/`;
        const jsonUrl = `${protocol}://${hostname}/json/`;
        const httpUrl = `${protocol}://${hostname}/http`;
        const mediaProxyUrl = `${protocol}://${hostname}/mediaProxy`;
        const hostUrl = `${hostname.split(':')[0]}`;
        const fServer = fastify.server;

        function getEnv(moduleName) {
            // const proxyUrl = `${protocol}://${hostname}/proxy/${moduleName}/?do=js`;
            const proxyUrl = `${protocol}://${hostname}${request.url}`.split('?')[0].replace('/parse/', '/proxy/') + '/?do=js';
            const getProxyUrl = function () {
                return proxyUrl
            };
            return {
                proxyUrl,
                publicUrl,
                jsonUrl,
                httpUrl,
                mediaProxyUrl,
                hostUrl,
                hostname,
                getProxyUrl,
                fServer,
                ext: moduleExt
            }
        }

        const env = getEnv('');
        try {
            const backResp = await drpy.jx(jxPath, env, query);
            const statusCode = 200;
            const mediaType = 'application/json; charset=utf-8';
            if (typeof backResp === 'object') {
                if (!backResp.code) {
                    let statusCode = backResp.url && backResp.url !== query.url ? 200 : 404;
                    backResp.code = statusCode
                }
                if (!backResp.msg) {
                    let msgState = backResp.url && backResp.url !== query.url ? '成功' : '失败';
                    backResp.msg = `${jxName}解析${msgState}`;
                }
                let t2 = (new Date()).getTime();
                backResp.cost = t2 - t1;
                let backRespSend = JSON.stringify(backResp);
                console.log(backRespSend);
                return reply.code(statusCode).type(`${mediaType}; charset=utf-8`).send(backRespSend);
            } else if (typeof backResp === 'string') {
                if (backResp.startsWith('redirect://')) {
                    return reply.redirect(backResp.split('redirect://')[1]);
                }
                let statusCode = backResp && backResp !== query.url ? 200 : 404;
                let msgState = backResp && backResp !== query.url ? '成功' : '失败';
                let t2 = (new Date()).getTime();
                let result = {
                    code: statusCode,
                    url: backResp,
                    msg: `${jxName}解析${msgState}`,
                    cost: t2 - t1
                }
                let backRespSend = JSON.stringify(result);
                console.log(backRespSend);
                return reply.code(statusCode).type(`${mediaType}; charset=utf-8`).send(backRespSend);
            } else {
                return reply.status(404).send({error: `${jxName}解析失败`});
            }

        } catch (error) {
            fastify.log.error(`Error proxy jx ${jxName}:${error.message}`);
            reply.status(500).send({error: `Failed to proxy jx ${jxName}: ${error.message}`});
        }
    });

    done();
};
