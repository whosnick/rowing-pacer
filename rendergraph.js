function getStrokeGraph(t, e, r, a, i, o) {
    var n, s, l = 1, h = [], p = 1, c = [], m = [], u = [], g = null, v = 1e3, b = 0, k = 40, x = 100, y = !1, f = o ? "Cadence" : "Stroke Rate", F = o ? "RPM" : "SPM", S = o ? 150 : 100;
    c[l] = [],
    u[l] = [],
    m[l] = [];
    for (var T in a)
        h[p++] = a[T].time;
    for (var W in t)
        n = t[W].t,
        d = t[W].d,
        i && (n < s && d < last_d || n < s && d < 50) && (l++,
        c[l] = [],
        u[l] = [],
        m[l] = []),
        (!i || i && n < h[l]) && t[W].p < 18e3 && (i || !i && (0 === W || n > 0)) && (u[l].push([n, t[W].hr]),
        m[l].push([n, t[W].p]),
        c[l].push([n, t[W].spm]),
        t[W].p > b && (b = t[W].p),
        t[W].p < v && 0 !== t[W].p && (v = t[W].p),
        t[W].spm > S && (g = S),
        t[W].hr > x && (x = t[W].hr),
        t[W].hr < k && (k = t[W].hr),
        !y && t[W].hr > 0 && (y = !0)),
        s = n,
        last_d = d;
    $(e).highcharts({
        credits: {
            enabled: !1
        },
        title: {
            text: null
        },
        chart: {
            zoomType: "xy",
            spacingBottom: 50,
            alignTicks: !0
        },
        yAxis: [{
            title: {
                text: "Pace"
            },
            min: v,
            max: b,
            labels: {
                formatter: function() {
                    return timeToString(this.value)
                }
            },
            reversed: !0
        }, {
            title: {
                text: f
            },
            min: 0,
            max: g,
            endOnTick: !1,
            gridLineWidth: 0,
            opposite: !0
        }, {
            min: k,
            max: x,
            alignTicks: !1,
            gridLineWidth: 0,
            title: {
                text: "Heart Rate"
            },
            labels: {
                format: "{value}",
                style: {
                    color: Highcharts.getOptions().colors[1]
                }
            },
            endOnTick: !1,
            opposite: !0
        }],
        xAxis: {
            title: {
                text: "Time"
            },
            labels: {
                formatter: function() {
                    return timeToString(this.value)
                }
            }
        },
        plotOptions: {
            line: {
                lineWidth: 1,
                states: {
                    hover: {
                        lineWidth: 2
                    }
                },
                marker: {
                    enabled: !1
                }
            }
        },
        tooltip: {
            shared: !0
        },
        legend: {
            enabled: !0,
            floating: !0,
            layout: "vertical",
            align: "right",
            verticalAlign: "bottom",
            borderWidth: 0,
            y: 40
        },
        series: [{
            yAxis: 0,
            name: "Pace",
            data: m[1],
            tooltip: {
                headerFormat: "",
                pointFormatter: function() {
                    var t = timeToString(this.y)
                      , e = timeToString(this.x);
                    return "<small>" + e + '</small><br><span style="color: ' + this.color + '">●</span> Pace: <b>' + t + "</b><br>"
                }
            }
        }, {
            yAxis: 1,
            name: F,
            data: c[1],
            tooltip: {
                headerFormat: "",
                pointFormatter: function() {
                    return '<span style="color: ' + this.color + '">●</span> ' + F + ": <b>" + this.y + "</b><br>"
                }
            }
        }, {
            yAxis: 2,
            name: "Heart Rate",
            data: u[1],
            color: "#FF0000",
            fillOpacity: .03,
            type: "area",
            lineWidth: 1,
            states: {
                hover: {
                    lineWidth: 2
                }
            },
            marker: {
                radius: 0
            },
            visible: y,
            tooltip: {
                headerFormat: "",
                pointFormatter: function() {
                    return '<span style="color: ' + this.color + '">●</span> HR: <b>' + this.y + "</b><br>"
                }
            }
        }]
    }),
    $("tr[data-interval='1']").css({
        backgroundColor: "pink"
    });
    var A = "Workout Graph";
    i && (A += ": Interval 1"),
    $(".graph-title").text(A);
    var O = $("#stroke-graph").highcharts();
    $(".js-interval").click(function() {
        var t = $(this).data("interval");
        $(".js-interval").css({
            backgroundColor: "inherit"
        }),
        $(this).css({
            backgroundColor: "pink"
        }),
        $(".graph-title").text("Workout Graph: Interval " + t),
        O.series[0].setData(m[t], !0, !0, !1),
        O.series[1].setData(c[t], !0, !0, !1),
        O.series[2].setData(u[t], !0, !0, !1)
    })
}
$.tablesorter.addWidget({
    id: "numbering",
    format: function(e) {
        e.config;
        $("tr:visible", e.tBodies[0]).each(function(e) {
            $(this).find("td").eq(0).text(e + 1)
        })
    }
}),
$.tablesorter.addWidget({
    id: "savePagerSize",
    init: function(e, t) {
        var r, i = $(e), o = $.tablesorter.storage, a = e.config, n = "tablesorter-pagesize";
        a && o && i.bind("pagerBeforeInitialized", function() {
            a.pager.sizeName = n,
            r = o(this, n) || a.pager.size,
            $.data(e, "pagerLastSize", r)
        }).bind("pagerChange", function() {
            o(this, n, a.pager.size)
        })
    },
    remove: function(e, t, r) {
        $.tablesorter.storage && ($.tablesorter.storage(e, t.pager.sizeName, ""),
        $.data(e, "pagerLastSize", 0))
    }
}),
$.tablesorter.themes.bootstrap = {
    table: "table log-tablesorter",
    iconSortNone: "bootstrap-icon-unsorted",
    iconSortAsc: "glyphicon glyphicon-chevron-up",
    iconSortDesc: "glyphicon glyphicon-chevron-down"
},
$.tablesorter.addParser({
    id: "numerify",
    is: function(e) {
        return !1
    },
    format: function(e) {
        return e.replace(/\D/g, "")
    },
    type: "numeric"
});