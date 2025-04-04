import Cinemeta from './util/cinemeta.js'
import DebridLink from './debrid-link.js'
import RealDebrid from './real-debrid.js'
import AllDebrid, { ADDON_URL } from './all-debrid.js'
import Premiumize from './premiumize.js'
import TorBox from './torbox.js'
import { BadRequestError } from './util/error-codes.js'
import { FILE_TYPES } from './util/file-types.js'
import { encode } from 'urlencode'

const STREAM_NAME_MAP = {
    debridlink: "[DL+] DebridSearch",
    realdebrid: "[RD+] DebridSearch",
    alldebrid: "[AD+] DebridSearch",
    premiumize: "[PM+] DebridSearch",
    torbox: "[TB+] DebridSearch"
}

async function getMovieStreams(config, type, id) {
    const cinemetaDetails = await Cinemeta.getMeta(type, id)
    const searchKey = cinemetaDetails.name

    let apiKey = config.DebridLinkApiKey ? config.DebridLinkApiKey : config.DebridApiKey

    if (config.DebridLinkApiKey || config.DebridProvider == "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => torrent.id)

            if (torrentIds && torrentIds.length) {
                return await DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList.map(torrentDetails => toStream(torrentDetails))
                    })
            }
        }
    } else if (config.DebridProvider == "RealDebrid") {
        let results = []
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterYear(torrent, cinemetaDetails))
                .map(torrent => {
                return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                    .then(torrentDetails => toStream(torrentDetails, type))
                    .catch(err => {
                        console.log(err)
                        Promise.resolve()
                    })
            }))
            results.push(...streams)
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.1)
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterYear(download, cinemetaDetails))
                .map(download => {return toStream(download, type)}))
            results.push(...streams)
        }
        return results.filter(stream => stream)
    } else if (config.DebridProvider == "AllDebrid") {
        let results = []

        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (items && items.length) {
            const streams = await Promise.all(
                items
                    .filter(item => filterYear(item, cinemetaDetails))
                    .map(async item => {
                        try {
                            if (item.type === 'direct') {
                                const hostUrl = item.url
                                const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type)
                            } else {
                                const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id)
                                if (!torrentDetails) {
                                    console.log(`Skipping torrent ${item.id}: No valid data`)
                                    return null
                                }
                                return toStream(torrentDetails)
                            }
                        } catch (err) {
                            console.log(`AllDebrid ${item.type} error:`, err)
                            return null
                        }
                    })
            )
            results.push(...streams)
        }

        return results.filter(stream => stream)
    } else if (config.DebridProvider == "Premiumize") {
        const files = await Premiumize.searchFiles(apiKey, searchKey, 0.1)
        if (files && files.length) {
            const streams = await Promise.all(
                files
                    .filter(file => filterYear(file, cinemetaDetails))
                    .map(torrent => {
                        return Premiumize.getTorrentDetails(apiKey, torrent.id)
                            .then(torrentDetails => toStream(torrentDetails))
                            .catch(err => {
                                console.log(err)
                                Promise.resolve()
                            })
                    })
            )

            return streams.filter(stream => stream)
        }
    } else if (config.DebridProvider == "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterYear(torrent, cinemetaDetails))
                    .map(torrentDetails => toStream(torrentDetails))
            )

            return streams.filter(stream => stream)
        }
    } else {
        return Promise.reject(BadRequestError)
    }

    return []
}

async function getSeriesStreams(config, type, id) {
    const [imdbId, season, episode] = id.split(":")
    const cinemetaDetails = await Cinemeta.getMeta(type, imdbId)
    const searchKey = cinemetaDetails.name

    let apiKey = config.DebridLinkApiKey ? config.DebridLinkApiKey : config.DebridApiKey

    if (config.DebridLinkApiKey || config.DebridProvider == "DebridLink") {
        const torrents = await DebridLink.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const torrentIds = torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => torrent.id)

            if (torrentIds && torrentIds.length) {
                return DebridLink.getTorrentDetails(apiKey, torrentIds.join())
                    .then(torrentDetailsList => {
                        return torrentDetailsList
                            .filter(torrentDetails => filterEpisode(torrentDetails, season, episode))
                            .map(torrentDetails => toStream(torrentDetails, type))
                    })
            }
        }
    } else if (config.DebridProvider == "RealDebrid") {
        let results = []
        const torrents = await RealDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return RealDebrid.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        })
                        .catch(err => {
                            console.log(err)
                            Promise.resolve()
                        })
                }))
            results.push(...streams)
        }

        const downloads = await RealDebrid.searchDownloads(apiKey, searchKey, 0.1)
        if (downloads && downloads.length) {
            const streams = await Promise.all(downloads
                .filter(download => filterDownloadEpisode(download, season, episode))
                .map(download => {return toStream(download, type)}))
            results.push(...streams)
        }
        return results.filter(stream => stream)
    } else if (config.DebridProvider == "AllDebrid") {
        let results = []

        const items = await AllDebrid.searchTorrents(apiKey, searchKey, 0.1)
        if (items && items.length) {
            const streams = await Promise.all(items
                .filter(item => filterSeason(item, season))
                .map(async item => {
                    try {
                        if (item.type === 'direct') {
                            const hostUrl = item.url
                            const url = `${ADDON_URL}/resolve/AllDebrid/${apiKey}/${encode(item.id)}/${encode(hostUrl)}`
                            if (filterDownloadEpisode(item, season, episode)) {
                                return toStream({
                                    source: 'alldebrid',
                                    id: item.id,
                                    name: item.name,
                                    type: 'direct',
                                    videos: [{ url: url, name: item.name, size: item.size, info: item.info }],
                                    size: item.size,
                                    info: item.info
                                }, type)
                            }
                        } else {
                            const torrentDetails = await AllDebrid.getTorrentDetails(apiKey, item.id)
                            if (!torrentDetails) {
                                console.log(`Skipping torrent ${item.id}: No valid data`)
                                return null
                            }
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        }
                    } catch (err) {
                        console.log(`AllDebrid ${item.type} error:`, err)
                        return null
                    }
                }))
            results.push(...streams)
        }

        return results.filter(stream => stream)
    } else if (config.DebridProvider == "Premiumize") {
        const torrents = await Premiumize.searchFiles(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(torrents
                .filter(torrent => filterSeason(torrent, season))
                .map(torrent => {
                    return Premiumize.getTorrentDetails(apiKey, torrent.id)
                        .then(torrentDetails => {
                            if (filterEpisode(torrentDetails, season, episode)) {
                                return toStream(torrentDetails, type)
                            }
                        })
                        .catch(err => {
                            console.log(err)
                            Promise.resolve()
                        })
                })
            )

            return streams.filter(stream => stream)
        }
    } else if (config.DebridProvider == "TorBox") {
        const torrents = await TorBox.searchTorrents(apiKey, searchKey, 0.1)
        if (torrents && torrents.length) {
            const streams = await Promise.all(
                torrents
                    .filter(torrent => filterEpisode(torrent, season, episode))
                    .map(torrentDetails => toStream(torrentDetails, type))
            )
            return streams.filter(stream => stream)
        }
    } else {
        return Promise.reject(BadRequestError)
    }

    return []
}

async function resolveUrl(debridProvider, debridApiKey, itemId, hostUrl, clientIp) {
    if (debridProvider == "DebridLink" || debridProvider == "Premiumize") {
        return hostUrl
    } else if (debridProvider == "RealDebrid") {
        return RealDebrid.unrestrictUrl(debridApiKey, hostUrl, clientIp)
    } else if (debridProvider == "AllDebrid") {
        return AllDebrid.unrestrictUrl(debridApiKey, hostUrl)
    } else if (debridProvider == "TorBox") {
        return TorBox.unrestrictUrl(debridApiKey, itemId, hostUrl, clientIp)
    } else {
        return Promise.reject(BadRequestError)
    }
}

function filterSeason(torrent, season) {
    return torrent?.info?.season == season || torrent?.info?.seasons?.includes(Number(season))
}

function filterEpisode(torrentDetails, season, episode) {
    torrentDetails.videos = torrentDetails.videos
        .filter(video => (season == video.info?.season) && (episode == video.info?.episode))
    return torrentDetails.videos && torrentDetails.videos.length
}

function filterYear(torrent, cinemetaDetails) {
    if (torrent?.info?.year && cinemetaDetails?.year) {
        return torrent.info.year == cinemetaDetails.year
    }
    return true
}

function filterDownloadEpisode(download, season, episode) {
    return download?.info?.season == season && download?.info?.episode == episode
}

function toStream(details, type) {
    if (!details) {
        console.log('toStream received null details, skipping');
        return null;
    }
    let video, icon;
    if (details.type === 'direct' || details.fileType == FILE_TYPES.DOWNLOADS) {
        icon = '⬇️';
        video = details.videos && details.videos.length ? details.videos[0] : {
            url: details.url,
            name: details.name,
            size: details.size,
            info: details.info
        };
    } else {
        icon = '💾';
        if (!details.videos || details.videos.length === 0) {
            return null;
        }
        video = details.videos.sort((a, b) => (b.size || 0) - (a.size || 0))[0];
    }

    let title = details.name;
    if (type === 'series') {
        title = title + '\n' + (video?.name || 'Unknown');
    }
    title = title + '\n' + icon + ' ' + formatSize(video?.size);

    let name = STREAM_NAME_MAP[details.source];
    const resolution = (video?.info?.resolution) || (details.info?.resolution) || 'Unknown';
    name = name + '\n' + resolution;

    let bingeGroup = details.source + '|' + details.id;

    return {
        name,
        title,
        url: video?.url || '',
        behaviorHints: {
            bingeGroup: bingeGroup
        }
    };
}

function formatSize(size) {
    if (!size) {
        return 'Unknown'
    }
    const i = size === 0 ? 0 : Math.floor(Math.log(size) / Math.log(1024))
    return Number((size / Math.pow(1024, i)).toFixed(2)) + ' ' + ['B', 'kB', 'MB', 'GB', 'TB'][i]
}

export default { getMovieStreams, getSeriesStreams, resolveUrl }